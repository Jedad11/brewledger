// WBS 3.8 tests — packages/shared/src/storage/compress.ts.
//
// Adaptation note (documented per the WBS 3.8 dispatch instructions, not
// silently skipped): compressImage() itself calls Image/document/
// URL.createObjectURL/canvas.toBlob, real browser-only globals with no
// Node equivalent. This sandbox has no headless-browser runner and no
// working native `canvas` binary available (attempted `canvas@3.2.3` as a
// devDependency during this WBS's own dispatch: it resolves and installs
// via pnpm, but ships no prebuilt binary for this Node/OS combination and
// there is no native toolchain here to build one from source — consistent
// with this repo's existing precedent of keeping native image libraries
// out entirely, see pnpm-workspace.yaml's `ignoredBuiltDependencies: sharp`.
// The dependency was removed again after confirming this; see the WBS 3.8
// report for the exact failure).
//
// So this file tests every DOM-free piece of compress.ts directly and for
// real — EXIF byte parsing against genuine hand-built JPEG/EXIF byte
// fixtures, canvas sizing arithmetic, the orientation-to-transform matrix
// table, and the quality-stepping loop against a synthetic (but
// size-vs-quality realistic) encoder — which is everything compress.ts
// does EXCEPT the actual pixel decode/re-encode, the one part that
// genuinely requires a browser. compressImage() itself (the DOM-dependent
// wrapper) is intentionally NOT exercised here.
import { describe, expect, it } from "vitest";
import {
  applyOrientationTransform,
  computeOrientedCanvasSize,
  computeScaledDimensions,
  readExifOrientation,
  runCompressionLoop,
  type Transform2DLike,
} from "./compress";

// ---------------------------------------------------------------------------
// JPEG/EXIF byte fixture builder — a real, minimal, structurally valid JPEG
// APP1/EXIF segment carrying exactly one IFD0 entry (tag 0x0112,
// Orientation). Mirrors what an actual phone camera writes, just trimmed to
// the one tag this parser looks for.
// ---------------------------------------------------------------------------
function buildJpegWithOrientation(orientation: number, littleEndian: boolean): ArrayBuffer {
  const entryCount = 1;
  const tiffHeaderLen = 8;
  const ifdLen = 2 + entryCount * 12 + 4; // count + entries + next-IFD offset
  const tiffLen = tiffHeaderLen + ifdLen;
  const exifPayloadLen = 6 + tiffLen; // "Exif\0\0" + TIFF
  const app1SegmentLen = 2 + exifPayloadLen; // includes the length field itself

  // SOI(2) + APP0 marker(2)+len(2)+"JFIF\0"+pad(9, arbitrary minimal JFIF) +
  // APP1 marker(2) + app1SegmentLen bytes.
  const app0Len = 16; // 2 (len field) + "JFIF\0"(5) + version/units/density/thumb(9)
  const totalLen = 2 + 2 + app0Len + 2 + app1SegmentLen;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  let o = 0;

  view.setUint16(o, 0xffd8, false); // SOI
  o += 2;

  // Minimal APP0/JFIF segment, purely to prove the walker skips segments
  // it doesn't care about before reaching APP1.
  view.setUint16(o, 0xffe0, false);
  o += 2;
  view.setUint16(o, app0Len, false);
  o += 2;
  const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"
  for (const b of jfif) {
    view.setUint8(o, b);
    o += 1;
  }
  o += app0Len - 2 - jfif.length; // skip the rest of the JFIF payload (zeros)

  // APP1/EXIF segment
  view.setUint16(o, 0xffe1, false);
  o += 2;
  view.setUint16(o, app1SegmentLen, false);
  o += 2;
  const exifTag = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  for (const b of exifTag) {
    view.setUint8(o, b);
    o += 1;
  }

  const tiffStart = o;
  if (littleEndian) {
    view.setUint16(o, 0x4949, false); // "II"
  } else {
    view.setUint16(o, 0x4d4d, false); // "MM"
  }
  o += 2;
  view.setUint16(o, 0x002a, littleEndian);
  o += 2;
  view.setUint32(o, 8, littleEndian); // IFD0 starts right after the 8-byte header
  o += 4;

  // IFD0
  view.setUint16(o, entryCount, littleEndian);
  o += 2;
  view.setUint16(o, 0x0112, littleEndian); // Orientation tag
  o += 2;
  view.setUint16(o, 3, littleEndian); // type = SHORT
  o += 2;
  view.setUint32(o, 1, littleEndian); // count = 1
  o += 4;
  view.setUint16(o, orientation, littleEndian); // value (first 2 of the 4-byte field)
  o += 4;
  view.setUint32(o, 0, littleEndian); // next IFD offset = none
  o += 4;

  expect(o).toBe(tiffStart + tiffLen);
  expect(o).toBe(totalLen);

  return buf;
}

describe("readExifOrientation", () => {
  it("returns 1 for a buffer that isn't a JPEG at all", () => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setUint16(0, 0x0000, false);
    expect(readExifOrientation(buf)).toBe(1);
  });

  it("returns 1 for a too-short buffer without throwing", () => {
    expect(readExifOrientation(new ArrayBuffer(2))).toBe(1);
  });

  it("returns 1 for a bare JPEG with no APP1/EXIF segment at all", () => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint16(0, 0xffd8, false);
    new DataView(buf).setUint16(2, 0xffd9, false); // SOI immediately followed by EOI
    expect(readExifOrientation(buf)).toBe(1);
  });

  it("reads orientation 6 (the common sideways-phone-photo case) from a little-endian (Intel/II) EXIF block", () => {
    const buf = buildJpegWithOrientation(6, true);
    expect(readExifOrientation(buf)).toBe(6);
  });

  it("reads orientation 8 from a little-endian EXIF block", () => {
    const buf = buildJpegWithOrientation(8, true);
    expect(readExifOrientation(buf)).toBe(8);
  });

  it("reads orientation 3 (upside down, 180°) from a big-endian (Motorola/MM) EXIF block", () => {
    const buf = buildJpegWithOrientation(3, false);
    expect(readExifOrientation(buf)).toBe(3);
  });

  it("reads orientation 1 (normal, no correction needed) explicitly", () => {
    const buf = buildJpegWithOrientation(1, true);
    expect(readExifOrientation(buf)).toBe(1);
  });
});

describe("computeScaledDimensions — longest-edge-1600px default", () => {
  it("leaves a small image untouched", () => {
    expect(computeScaledDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a large landscape photo down so the longest edge is exactly the cap", () => {
    const result = computeScaledDimensions(4032, 3024, 1600); // typical iPhone photo
    expect(Math.max(result.width, result.height)).toBe(1600);
    expect(result.width / result.height).toBeCloseTo(4032 / 3024, 2);
  });

  it("scales a large portrait photo the same way on the other axis", () => {
    const result = computeScaledDimensions(3024, 4032, 1600);
    expect(Math.max(result.width, result.height)).toBe(1600);
    expect(result.height).toBe(1600);
  });
});

describe("computeOrientedCanvasSize — the 'comes out upright' contract", () => {
  it("orientation 1 (normal): canvas keeps the source dimensions", () => {
    expect(computeOrientedCanvasSize(1, 1600, 1200)).toEqual({ width: 1600, height: 1200 });
  });

  it("orientation 6 — a phone held sideways: a LANDSCAPE-shaped raw sensor image (1600x1200) must produce a PORTRAIT canvas (1200x1600), the actual upright bill", () => {
    const result = computeOrientedCanvasSize(6, 1600, 1200);
    expect(result).toEqual({ width: 1200, height: 1600 });
    expect(result.height).toBeGreaterThan(result.width); // portrait, not stretched-landscape
  });

  it("orientation 8 also swaps dimensions (the other sideways rotation)", () => {
    expect(computeOrientedCanvasSize(8, 1600, 1200)).toEqual({ width: 1200, height: 1600 });
  });

  it("orientation 3 (180°, upside down) keeps dimensions — only 5-8 swap", () => {
    expect(computeOrientedCanvasSize(3, 1600, 1200)).toEqual({ width: 1600, height: 1200 });
  });
});

describe("applyOrientationTransform — canonical EXIF transform matrix", () => {
  function recorder(): { ctx: Transform2DLike; calls: number[][] } {
    const calls: number[][] = [];
    return {
      calls,
      ctx: {
        transform: (a, b, c, d, e, f) => {
          calls.push([a, b, c, d, e, f]);
        },
      },
    };
  }

  it("orientation 1: no transform call at all (identity)", () => {
    const { ctx, calls } = recorder();
    applyOrientationTransform(ctx, 1, 800, 600);
    expect(calls).toHaveLength(0);
  });

  it("orientation 6: rotate-90 matrix translates by the source height on the x-axis", () => {
    const { ctx, calls } = recorder();
    applyOrientationTransform(ctx, 6, 800, 600);
    expect(calls).toEqual([[0, 1, -1, 0, 600, 0]]);
  });

  it("orientation 3: 180° flip matrix translates by width and height", () => {
    const { ctx, calls } = recorder();
    applyOrientationTransform(ctx, 3, 800, 600);
    expect(calls).toEqual([[-1, 0, 0, -1, 800, 600]]);
  });

  it("every one of the 8 EXIF orientation values produces at most one transform call", () => {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const { ctx, calls } = recorder();
      applyOrientationTransform(ctx, orientation, 800, 600);
      expect(calls.length).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Quality-stepping loop — a real, deterministic test of the actual
// algorithm compress.ts runs (loop quality down in 0.05 steps to a floor of
// 0.5 until <= target), against a synthetic encoder standing in for
// canvas.toBlob. The encoder models realistic JPEG behavior (size shrinks
// monotonically as quality drops) rather than real pixels, which is exactly
// the DOM-free boundary described in this file's header comment.
// ---------------------------------------------------------------------------
function fakeBlob(size: number): Blob {
  return new Blob([new Uint8Array(size)]);
}

describe("runCompressionLoop", () => {
  const opts = { initialQuality: 0.8, qualityStep: 0.05, minQuality: 0.5, targetBytes: 200 * 1024 };

  it("a real-ish large 'photo' (starts well above 200 KB at quality 0.8) compresses to <= 200 KB before hitting the quality floor", async () => {
    // JPEG size scales roughly with quality^2 in practice; this constant is
    // picked so the modeled photo starts at ~256 KB (above target) at 0.8
    // and crosses under the 200 KB target around quality 0.70 — well above
    // the 0.5 floor, so this proves the loop actually stops EARLY when the
    // target is reached, not just that it bottoms out.
    const sizeAtQuality = (q: number) => Math.round(400_000 * q * q);
    let calls = 0;
    const blob = await runCompressionLoop(async (q) => {
      calls += 1;
      return fakeBlob(sizeAtQuality(q));
    }, opts);

    expect(blob.size).toBeLessThanOrEqual(opts.targetBytes);
    expect(calls).toBeGreaterThan(1); // did not succeed on the first try
    expect(calls).toBeLessThan(7); // (0.8 - 0.5) / 0.05 + 1 = 7 possible steps max
  });

  it("succeeds immediately if the first encode is already under target", async () => {
    let calls = 0;
    const blob = await runCompressionLoop(async () => {
      calls += 1;
      return fakeBlob(50 * 1024);
    }, opts);
    expect(blob.size).toBe(50 * 1024);
    expect(calls).toBe(1);
  });

  it("stops at the quality floor (0.5) and returns the best-effort result even if still over target", async () => {
    let lowestQualityUsed = 1;
    const blob = await runCompressionLoop(async (q) => {
      lowestQualityUsed = Math.min(lowestQualityUsed, q);
      return fakeBlob(500 * 1024); // never gets under target at any quality
    }, opts);
    expect(lowestQualityUsed).toBe(0.5);
    expect(blob.size).toBe(500 * 1024); // returns rather than looping forever
  });

  it("never asks for a quality below the floor", async () => {
    const qualitiesUsed: number[] = [];
    await runCompressionLoop(async (q) => {
      qualitiesUsed.push(q);
      return fakeBlob(9_999_999);
    }, opts);
    expect(Math.min(...qualitiesUsed)).toBeGreaterThanOrEqual(opts.minQuality);
  });

  it("steps down in increments of exactly 0.05", async () => {
    const qualitiesUsed: number[] = [];
    await runCompressionLoop(async (q) => {
      qualitiesUsed.push(q);
      return fakeBlob(9_999_999);
    }, opts);
    for (let i = 1; i < qualitiesUsed.length; i += 1) {
      expect(qualitiesUsed[i - 1] - qualitiesUsed[i]).toBeCloseTo(0.05, 5);
    }
  });
});
