// WBS 4.6 — decode the generated QR payload and assert it matches the
// expected public store URL exactly, with no extra query parameters.
//
// No jsdom/@testing-library harness exists in this repo (see
// PaymentsSettingsForm.test.tsx's own header comment) and no canvas/image
// rendering is available in plain Node either, so this doesn't render an
// <img> or a <canvas> at all: `qrcode`'s QRCode.create() returns the raw
// module (bit) matrix that the real client-side rendering path (QRCode.
// toDataURL in StoreLinkQR.tsx) encodes into a PNG -- both call into the
// same encoder, so decoding the matrix here proves the same payload the
// real screen renders. The matrix is rasterised by hand into an RGBA pixel
// buffer (each module scaled to a block of solid black/white pixels, plus a
// quiet zone) and fed to jsQR, a pure-JS QR decoder that only needs pixel
// data -- no native canvas dependency required.
//
// "@/..." is not used here (same gap noted in slug.test.ts / actions.test.ts's
// own comments -- vitest has no tsconfig-paths alias plugin in this repo);
// lib/slug.ts is imported by relative path instead.
// redline_reviewer MEDIUM finding (StoreLinkQR.tsx): an unpublished store
// was dimmed with CSS only -- the underlying <img> still held a fully
// scannable QR (opacity/grayscale is a rendering hint, not a degradation of
// the encoded data). Fix: QRCode.toDataURL is now gated on
// `shouldGenerateQr(store)` and never called at all while unpublished; the
// unpublished branch renders a plain, static placeholder <div> with no
// image and no data URL. Two things are worth proving here:
//   1. the gate itself -- shouldGenerateQr is exported specifically so this
//      can be asserted directly, since useEffect never runs under
//      react-dom/server's renderToStaticMarkup (no jsdom in this repo, see
//      PaymentsSettingsForm.test.tsx's own header comment), so a rendered
//      snapshot alone can't distinguish "effect never fires" from "effect
//      hasn't fired yet".
//   2. the unpublished render path itself never contains an <img> or a
//      "data:image" payload, static-render or not.
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { buildPublicStoreUrl, PUBLIC_STORE_HOST } from "../../../../../lib/slug";
import { DOWNLOAD_PNG_LABEL, DOWNLOAD_PDF_LABEL } from "./copy";

// apps/console/vitest.config.ts (added for StoreProfileForm.test.tsx's jsdom
// environment, see that file's header comment) now aliases "@/*" to a real
// "./src/*" resolution, which makes "@/lib/slug" and the relative import
// above resolve to the literal same module -- so a factory that CLOSES OVER
// the top-level `buildPublicStoreUrl` binding (the previous form here) is a
// genuine hoisting hazard once that's true (Vitest's own restriction: "no
// top level variables inside" a vi.mock factory, since the call is hoisted
// above the import that initializes it), and fails with a real
// ReferenceError. vi.importActual sidesteps this by not closing over
// anything -- it re-imports the real module fresh from inside the factory
// instead, matching the pattern actions.test.ts / StoreProfileForm.test.tsx
// use for the same "@/lib/slug" specifier. Still exercises the real
// URL-building behavior, not a stub.
vi.mock("@/lib/slug", async () => {
  const actual = await vi.importActual("../../../../../lib/slug");
  return actual;
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { StoreLinkQR, shouldGenerateQr } = await import("./StoreLinkQR");

function rasterizeModules(
  modules: { data: Uint8Array; size: number },
  moduleScalePx: number,
  quietZoneModules: number,
): { pixels: Uint8ClampedArray; width: number; height: number } {
  const size = modules.size;
  const totalModules = size + quietZoneModules * 2;
  const width = totalModules * moduleScalePx;
  const height = width;

  const pixels = new Uint8ClampedArray(width * height * 4).fill(255); // white, opaque

  for (let my = 0; my < size; my++) {
    for (let mx = 0; mx < size; mx++) {
      const dark = modules.data[my * size + mx] & 1;
      if (!dark) continue;
      const px0 = (mx + quietZoneModules) * moduleScalePx;
      const py0 = (my + quietZoneModules) * moduleScalePx;
      for (let dy = 0; dy < moduleScalePx; dy++) {
        for (let dx = 0; dx < moduleScalePx; dx++) {
          const idx = ((py0 + dy) * width + (px0 + dx)) * 4;
          pixels[idx] = 0;
          pixels[idx + 1] = 0;
          pixels[idx + 2] = 0;
          pixels[idx + 3] = 255;
        }
      }
    }
  }
  return { pixels, width, height };
}

function decodeQrPayload(text: string): string | null {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { pixels, width, height } = rasterizeModules(qr.modules, 4, 4);
  const result = jsQR(pixels, width, height);
  return result?.data ?? null;
}

describe("store QR payload (WBS 4.6)", () => {
  it("decodes to exactly the public store URL, https://{host}/s/{slug}", () => {
    const slug = "baan-suan-coffee-42";
    const expectedUrl = buildPublicStoreUrl(slug);

    expect(expectedUrl).toBe(`https://${PUBLIC_STORE_HOST}/s/${slug}`);
    expect(decodeQrPayload(expectedUrl)).toBe(expectedUrl);
  });

  it("carries no query string -- no merchant id, store id, or token (RL-3)", () => {
    const expectedUrl = buildPublicStoreUrl("another-cafe");
    const decoded = decodeQrPayload(expectedUrl);

    expect(decoded).not.toBeNull();
    expect(decoded).not.toContain("?");
    expect(decoded).not.toContain("&");
    expect(decoded).toBe(expectedUrl);
  });

  it("a different slug produces a different, still-exact payload -- not a fixed/stale URL", () => {
    const urlA = buildPublicStoreUrl("cafe-a");
    const urlB = buildPublicStoreUrl("cafe-b");

    expect(decodeQrPayload(urlA)).toBe(urlA);
    expect(decodeQrPayload(urlB)).toBe(urlB);
    expect(urlA).not.toBe(urlB);
  });
});

describe("unpublished store never gets a scannable QR (WBS 4.6 / redline fix)", () => {
  const PUBLISHED = { name: "ร้านกาแฟ", slug: "cafe-a", isPublished: true };
  const UNPUBLISHED = { name: "ร้านกาแฟ", slug: "cafe-a", isPublished: false };

  it("shouldGenerateQr is false for null and for an unpublished store", () => {
    expect(shouldGenerateQr(null)).toBe(false);
    expect(shouldGenerateQr(UNPUBLISHED)).toBe(false);
  });

  it("shouldGenerateQr is true only once the store is published", () => {
    expect(shouldGenerateQr(PUBLISHED)).toBe(true);
  });

  it("renders no <img> and no data:image payload while unpublished", () => {
    const html = renderToStaticMarkup(React.createElement(StoreLinkQR, { store: UNPUBLISHED }));

    expect(html).not.toContain("<img");
    expect(html).not.toContain("data:image");
  });

  // handleDownloadPng/handleDownloadPdf themselves aren't exported and can't
  // be invoked directly without jsdom (no click simulation available in this
  // repo -- see this file's own header comment), so this can't prove the
  // in-handler `!ownedStore.isPublished` early-return fires. What it does
  // prove: `actionsDisabled` (`!ownedStore.isPublished || !qrDataUrl`) is
  // wired through to the actual DOM `disabled` attribute on both download
  // buttons at initial render, which is the first line of defense a user
  // (or a screenshot/macro) would hit before ever reaching the handler.
  it("download PNG and PDF buttons render disabled while unpublished", () => {
    const html = renderToStaticMarkup(React.createElement(StoreLinkQR, { store: UNPUBLISHED }));

    const pngButton = html.match(/<button[^>]*>ดาวน์โหลด QR \(PNG\)<\/button>/);
    const pdfButton = html.match(/<button[^>]*>ดาวน์โหลด PDF สำหรับพิมพ์<\/button>/);

    expect(pngButton?.[0]).toContain(DOWNLOAD_PNG_LABEL);
    expect(pdfButton?.[0]).toContain(DOWNLOAD_PDF_LABEL);
    expect(pngButton?.[0]).toMatch(/\sdisabled(="")?[\s>]/);
    expect(pdfButton?.[0]).toMatch(/\sdisabled(="")?[\s>]/);
  });
});
