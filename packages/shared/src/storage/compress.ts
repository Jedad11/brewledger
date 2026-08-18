// WBS 3.8 — browser-side compression for bill photos before upload.
//
// Quota arithmetic: the Supabase free tier gives 1 GB total Storage. An
// unmodified phone camera photo is commonly ~4 MB, so an uncompressed pilot
// would exhaust the whole quota in ~250 bills (1 GB / 4 MB). Compressing
// each photo to <=200 KB before it ever leaves the browser stretches the
// same 1 GB to ~5,000 bills (1 GB / 200 KB) -- comfortably past what the PoC
// pilot shops will produce. This file is the only thing standing between
// "works in the demo" and "the bucket is full in week two."
//
// Canvas API only, no image-processing dependency. Runs in the browser
// only -- Image/document/URL.createObjectURL/canvas.toBlob have no Node
// equivalent, which is also why the pure, DOM-free pieces below
// (readExifOrientation, computeScaledDimensions, computeOrientedCanvasSize,
// applyOrientationTransform, runCompressionLoop) are split out as their own
// exports: they are the part a Node test runner can actually exercise
// without a browser or a native canvas binary. See
// packages/shared/src/storage/compress.test.ts's header comment for exactly
// which assertions that limits us to.

export interface CompressImageOptions {
  maxEdgePx?: number;
  initialQuality?: number;
  qualityStep?: number;
  minQuality?: number;
  targetBytes?: number;
  mimeType?: string;
}

interface ResolvedCompressImageOptions {
  maxEdgePx: number;
  initialQuality: number;
  qualityStep: number;
  minQuality: number;
  targetBytes: number;
  mimeType: string;
}

const DEFAULTS: ResolvedCompressImageOptions = {
  maxEdgePx: 1600,
  initialQuality: 0.8,
  qualityStep: 0.05,
  minQuality: 0.5,
  targetBytes: 200 * 1024,
  mimeType: "image/jpeg",
};

// ---------------------------------------------------------------------------
// EXIF orientation — pure byte parsing over an ArrayBuffer, no DOM needed.
// Ported from the standard JPEG/EXIF APP1 walk (TIFF header -> IFD0 ->
// tag 0x0112). Returns 1 (no correction needed) for any non-JPEG input,
// any JPEG with no EXIF APP1 segment, or a malformed segment — 1 is also
// the EXIF spec's own "normal, no rotation" value, so an unreadable file
// degrades to "leave it alone" rather than guessing.
// ---------------------------------------------------------------------------
export function readExifOrientation(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 4) return 1;
  const view = new DataView(buffer);
  if (view.getUint16(0, false) !== 0xffd8) return 1;

  const length = view.byteLength;
  let offset = 2;

  while (offset + 4 <= length) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffe1) {
      // offset currently points at the APP1 segment's 2-byte length field.
      // Skip it, then require the next 4 bytes to spell "Exif".
      const exifTagOffset = offset + 2;
      if (exifTagOffset + 4 > length) return 1;
      if (view.getUint32(exifTagOffset, false) !== 0x45786966) return 1;

      const tiffStart = exifTagOffset + 6; // skip "Exif\0\0"
      if (tiffStart + 8 > length) return 1;
      const little = view.getUint16(tiffStart, false) === 0x4949;
      const ifd0Offset = view.getUint32(tiffStart + 4, little);
      const dirStart = tiffStart + ifd0Offset;
      if (dirStart + 2 > length) return 1;

      const entryCount = view.getUint16(dirStart, little);
      for (let i = 0; i < entryCount; i += 1) {
        const entryOffset = dirStart + 2 + i * 12;
        if (entryOffset + 12 > length) break;
        const tag = view.getUint16(entryOffset, little);
        if (tag === 0x0112) {
          return view.getUint16(entryOffset + 8, little);
        }
      }
      return 1;
    }

    if ((marker & 0xff00) !== 0xff00) break; // not a marker, stop walking
    if (marker === 0xffd8 || marker === 0xffd9) continue; // no length field

    if (offset + 2 > length) break;
    const segmentLength = view.getUint16(offset, false);
    offset += segmentLength;
  }

  return 1;
}

// ---------------------------------------------------------------------------
// Scaling / canvas sizing — pure arithmetic, no DOM needed.
// ---------------------------------------------------------------------------
export function computeScaledDimensions(
  width: number,
  height: number,
  maxEdgePx: number,
): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdgePx) return { width, height };
  const scale = maxEdgePx / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Orientations 5-8 rotate the image a quarter turn, so the canvas the
// (already-scaled) pixels get drawn onto must swap width/height for the
// output to come out upright instead of stretched. This is the exact case
// that matters for a phone held sideways (orientation 6 or 8 on nearly
// every Android/iOS camera).
export function computeOrientedCanvasSize(
  orientation: number,
  width: number,
  height: number,
): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

// A minimal structural subset of CanvasRenderingContext2D — lets tests pass
// a plain recording object instead of a real browser canvas context, while
// the real compressImage() below passes a real one (it satisfies this shape
// structurally, no cast needed).
export interface Transform2DLike {
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

// Canonical EXIF-orientation-to-canvas-transform table. `width`/`height`
// here are the SOURCE (pre-rotation) drawn dimensions, matching the
// `ctx.drawImage(img, 0, 0, width, height)` call this is paired with in
// compressImage() below.
export function applyOrientationTransform(
  ctx: Transform2DLike,
  orientation: number,
  width: number,
  height: number,
): void {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break; // orientation 1 (or unknown) — identity, no transform needed
  }
}

// ---------------------------------------------------------------------------
// Quality-stepping loop — pure over an injected encode function, no DOM
// needed. compressImage() below supplies a real canvas.toBlob encoder;
// tests supply a synthetic one that models size-vs-quality behavior.
// ---------------------------------------------------------------------------
export interface CompressionLoopOptions {
  initialQuality: number;
  qualityStep: number;
  minQuality: number;
  targetBytes: number;
}

export async function runCompressionLoop(
  encode: (quality: number) => Promise<Blob>,
  opts: CompressionLoopOptions,
): Promise<Blob> {
  let quality = opts.initialQuality;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const blob = await encode(quality);
    if (blob.size <= opts.targetBytes || quality <= opts.minQuality) {
      return blob;
    }
    quality = Math.max(opts.minQuality, Math.round((quality - opts.qualityStep) * 100) / 100);
  }
}

// ---------------------------------------------------------------------------
// Browser-only glue — Image/document/canvas.toBlob have no Node equivalent.
// ---------------------------------------------------------------------------
function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err instanceof Error ? err : new Error("compressImage: failed to decode image"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("compressImage: canvas.toBlob returned null"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Compresses a bill/menu photo entirely client-side: scales the longest
 * edge to <= maxEdgePx (default 1600), corrects EXIF rotation so a sideways
 * phone photo comes out upright, then re-encodes as JPEG (default),
 * stepping quality down from 0.8 in 0.05 increments to a floor of 0.5 until
 * the result is <= targetBytes (default 200 KB) or the floor is hit.
 */
export async function compressImage(file: File, opts: CompressImageOptions = {}): Promise<Blob> {
  const resolved: ResolvedCompressImageOptions = { ...DEFAULTS, ...opts };

  const buffer = await file.arrayBuffer();
  const orientation = readExifOrientation(buffer);

  const img = await loadImageElement(file);
  const { width: drawWidth, height: drawHeight } = computeScaledDimensions(
    img.naturalWidth,
    img.naturalHeight,
    resolved.maxEdgePx,
  );
  const { width: canvasWidth, height: canvasHeight } = computeOrientedCanvasSize(
    orientation,
    drawWidth,
    drawHeight,
  );

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("compressImage: 2d canvas context unavailable");

  applyOrientationTransform(ctx, orientation, drawWidth, drawHeight);
  ctx.drawImage(img, 0, 0, drawWidth, drawHeight);

  return runCompressionLoop(
    (quality) => canvasToBlob(canvas, resolved.mimeType, quality),
    {
      initialQuality: resolved.initialQuality,
      qualityStep: resolved.qualityStep,
      minQuality: resolved.minQuality,
      targetBytes: resolved.targetBytes,
    },
  );
}
