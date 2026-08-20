import { jsPDF } from "jspdf";
import { PRINT_CTA } from "./copy";

// WBS 4.6 — client-side A5/A6 print sheet. Rendered onto an offscreen
// <canvas> at print resolution rather than typeset directly with jsPDF's
// own text API: jsPDF's built-in fonts only cover WinAnsi (Latin) glyphs,
// so any Thai text drawn with them would come out as tofu/missing glyphs.
// Canvas 2D text, like every other Thai string in this app, renders through
// the browser's normal font stack and its normal Unicode fallback -- so a
// generic "sans-serif"/"monospace" family here gets real Thai glyphs for
// free, the same way plain DOM text already does everywhere else in the
// console. The finished canvas is then embedded as a single full-page image
// in the PDF, sidestepping the font-embedding problem entirely.
export type PrintSize = "a5" | "a6";

export const PRINT_PAGE_MM: Record<PrintSize, { width: number; height: number }> = {
  a5: { width: 148, height: 210 },
  a6: { width: 105, height: 148 },
};

// 300 DPI keeps an inkjet-printed A6 QR crisp at the WBS's own acceptance
// bar (scans reliably from 30cm on a mid-range Android phone).
const PRINT_DPI = 300;
const MM_PER_INCH = 25.4;

function mmToPx(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * PRINT_DPI);
}

const LAYOUT: Record<
  PrintSize,
  {
    marginMm: number;
    nameMaxFontMm: number;
    nameMinFontMm: number;
    gapNameToQrMm: number;
    gapQrToUrlMm: number;
    urlFontMm: number;
    ctaFontMm: number;
  }
> = {
  a5: { marginMm: 12, nameMaxFontMm: 12, nameMinFontMm: 6, gapNameToQrMm: 8, gapQrToUrlMm: 10, urlFontMm: 5, ctaFontMm: 6 },
  a6: { marginMm: 8, nameMaxFontMm: 9, nameMinFontMm: 5, gapNameToQrMm: 5, gapQrToUrlMm: 7, urlFontMm: 4, ctaFontMm: 4.5 },
};

// Word-wrap with a character-level fallback for a single "word" wider than
// the page: Thai text commonly has no spaces at all, so a 40-character Thai
// store name (CLAUDE.md's own test case) can be one unbroken "word" that
// still needs to wrap rather than overflow the sheet.
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";

  function chunkWord(word: string): string {
    let chunk = "";
    for (const ch of word) {
      const next = chunk + ch;
      if (chunk.length > 0 && ctx.measureText(next).width > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    return chunk;
  }

  for (const word of text.split(" ")) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
      current = "";
    }
    current = ctx.measureText(word).width > maxWidth ? chunkWord(word) : word;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

// Shrinks the store-name font until it wraps to at most `maxLines`, down to
// a floor -- keeps a long name legible instead of overflowing the sheet.
function fitStoreName(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startFontPx: number,
  minFontPx: number,
  maxLines: number,
): { fontPx: number; lines: string[] } {
  let fontPx = startFontPx;
  let lines: string[] = [];
  while (fontPx >= minFontPx) {
    ctx.font = `bold ${fontPx}px sans-serif`;
    lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { fontPx, lines };
    fontPx -= 4;
  }
  return { fontPx: minFontPx, lines: lines.slice(0, maxLines) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("qr image failed to load"));
    img.src = src;
  });
}

export async function renderPrintCanvas(opts: {
  size: PrintSize;
  storeName: string;
  url: string;
  qrDataUrl: string;
}): Promise<HTMLCanvasElement> {
  const { size, storeName, url, qrDataUrl } = opts;
  const layout = LAYOUT[size];
  const { width: wMm, height: hMm } = PRINT_PAGE_MM[size];
  const width = mmToPx(wMm);
  const height = mmToPx(hMm);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = "center";

  const margin = mmToPx(layout.marginMm);
  const contentWidth = width - margin * 2;
  const centerX = width / 2;

  const { fontPx: nameFontPx, lines: nameLines } = fitStoreName(
    ctx,
    storeName,
    contentWidth,
    mmToPx(layout.nameMaxFontMm),
    mmToPx(layout.nameMinFontMm),
    2,
  );
  ctx.font = `bold ${nameFontPx}px sans-serif`;
  ctx.fillStyle = "#1f2421";
  const nameLineHeight = nameFontPx * 1.35; // CLAUDE.md: heading line-height >=1.35
  let cursorY = margin + nameFontPx;
  for (const line of nameLines) {
    ctx.fillText(line, centerX, cursorY);
    cursorY += nameLineHeight;
  }

  // QR: centred, >=60% of sheet width (WBS 4.6 acceptance).
  const qrSize = Math.round(width * 0.65);
  const qrImage = await loadImage(qrDataUrl);
  const qrY = cursorY + mmToPx(layout.gapNameToQrMm);
  ctx.drawImage(qrImage, centerX - qrSize / 2, qrY, qrSize, qrSize);

  // URL as readable text beneath the QR -- some customers will type it.
  const urlFontPx = mmToPx(layout.urlFontMm);
  ctx.font = `${urlFontPx}px monospace`;
  ctx.fillStyle = "#1f2421";
  let urlY = qrY + qrSize + mmToPx(layout.gapQrToUrlMm);
  for (const line of wrapText(ctx, url, contentWidth)) {
    ctx.fillText(line, centerX, urlY);
    urlY += urlFontPx * 1.5;
  }

  const ctaFontPx = mmToPx(layout.ctaFontMm);
  ctx.font = `bold ${ctaFontPx}px sans-serif`;
  ctx.fillStyle = "#234936";
  ctx.fillText(PRINT_CTA, centerX, urlY + ctaFontPx);

  return canvas;
}

export async function downloadPrintPdf(opts: {
  size: PrintSize;
  storeName: string;
  url: string;
  qrDataUrl: string;
  slug: string;
}): Promise<void> {
  const canvas = await renderPrintCanvas(opts);
  const { width: wMm, height: hMm } = PRINT_PAGE_MM[opts.size];

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [wMm, hMm] });
  doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, wMm, hMm);
  doc.save(`qr-${opts.slug}-${opts.size}.pdf`);
}

export function downloadQrPng(qrDataUrl: string, slug: string): void {
  const a = document.createElement("a");
  a.href = qrDataUrl;
  a.download = `qr-${slug}.png`;
  a.click();
}
