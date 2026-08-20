"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Card, Button, EmptyState } from "@brewledger/ui";
import { buildPublicStoreUrl } from "@/lib/slug";
import { downloadPrintPdf, downloadQrPng, type PrintSize } from "./printSheet";
import {
  NO_STORE_TITLE,
  NO_STORE_BODY,
  NO_STORE_ACTION,
  UNPUBLISHED_TITLE,
  UNPUBLISHED_BODY,
  UNPUBLISHED_ACTION,
  URL_LABEL,
  COPY_LABEL,
  COPY_SUCCESS,
  COPY_FAILED,
  QR_FAILED,
  PRINT_FAILED,
  DOWNLOAD_PNG_LABEL,
  PRINT_SECTION_LABEL,
  SIZE_A5_LABEL,
  SIZE_A6_LABEL,
  DOWNLOAD_PDF_LABEL,
} from "./copy";

// WBS 4.6 — /console/settings/link. Copy: docs/design/state_matrix.md
// "ลิงก์ร้านและ QR /console/settings/link" (added in this change; no
// prototype screen exists for this route). RL-3: the QR/link payload is
// built by buildPublicStoreUrl (apps/console/src/lib/slug.ts) and is
// EXACTLY https://{host}/s/{slug} -- no merchant id, store id, or token.
// Anything more would be a potential enumeration vector baked into an image
// that gets photographed by strangers and taped to a public counter.
const PRINT_SIZE_ORDER: PrintSize[] = ["a5", "a6"];
const SIZE_LABELS: Record<PrintSize, string> = { a5: SIZE_A5_LABEL, a6: SIZE_A6_LABEL };

export interface StoreLinkQRStore {
  name: string;
  slug: string;
  isPublished: boolean;
}

// Exported so qr.test.ts can assert the gate directly: this is the one
// condition that decides whether a real, scannable payload ever gets
// encoded. A CSS-only "greyed out" treatment on top of a generated QR is
// not enough -- the fix is not calling QRCode.toDataURL at all here.
export function shouldGenerateQr(store: StoreLinkQRStore | null): boolean {
  return !!store && store.isPublished;
}

export function StoreLinkQR({ store }: { store: StoreLinkQRStore | null }) {
  const router = useRouter();

  const publicUrl = store ? buildPublicStoreUrl(store.slug) : "";

  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [qrError, setQrError] = React.useState(false);
  const [copyStatus, setCopyStatus] = React.useState<"idle" | "success" | "error">("idle");
  const [printSize, setPrintSize] = React.useState<PrintSize>("a5");
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const [pdfError, setPdfError] = React.useState(false);

  React.useEffect(() => {
    // Gate generation itself on isPublished, not just the surrounding
    // buttons -- an unpublished store must never have a fully-decodable QR
    // sitting in the DOM for "Save image as" to lift, no matter what CSS
    // does to it on screen (redline_reviewer finding on this file). No
    // setState here on the early-return path: the unpublished render branch
    // below never reads qrDataUrl at all, and the download handlers are
    // hardened against a stale one below too, so there's nothing to reset --
    // and resetting synchronously in an effect body is its own cascading-
    // render footgun (react-hooks/set-state-in-effect).
    if (!shouldGenerateQr(store)) return;

    let cancelled = false;
    QRCode.toDataURL(publicUrl, {
      // WBS 4.6: "M or Q". M keeps the module grid smaller for a short URL
      // payload than Q would, which prints each module bigger at a fixed
      // sheet size -- more reliable to scan from 30cm, the acceptance bar.
      errorCorrectionLevel: "M",
      margin: 4, // quiet zone, in modules
      width: 1024, // WBS 4.6: minimum 1024x1024 so an inkjet print stays crisp
    })
      .then((dataUrl) => {
        if (cancelled) return;
        setQrDataUrl(dataUrl);
        setQrError(false);
      })
      .catch((err) => {
        console.error("store QR generation failed", err);
        if (cancelled) return;
        setQrDataUrl(null);
        setQrError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [store, publicUrl]);

  if (!store) {
    return (
      <EmptyState
        title={NO_STORE_TITLE}
        body={NO_STORE_BODY}
        action={{ label: NO_STORE_ACTION, onPress: () => router.push("/console/settings/store") }}
      />
    );
  }

  // `store` is narrowed non-null above, but that narrowing doesn't survive
  // into the nested closures below (same TS limitation PaymentsSettingsForm's
  // `ownedStoreId` works around) -- rebind once to a definitely-non-null local.
  const ownedStore: StoreLinkQRStore = store;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopyStatus("success");
    } catch (err) {
      console.error("copy store link failed", err);
      setCopyStatus("error");
    }
    window.setTimeout(() => setCopyStatus("idle"), 2500);
  }

  function handleDownloadPng() {
    if (!qrDataUrl || !ownedStore.isPublished) return;
    downloadQrPng(qrDataUrl, ownedStore.slug);
  }

  async function handleDownloadPdf() {
    if (!qrDataUrl || !ownedStore.isPublished) return;
    setPdfBusy(true);
    setPdfError(false);
    try {
      await downloadPrintPdf({
        size: printSize,
        storeName: ownedStore.name,
        url: publicUrl,
        qrDataUrl,
        slug: ownedStore.slug,
      });
    } catch (err) {
      console.error("print PDF generation failed", err);
      setPdfError(true);
    } finally {
      setPdfBusy(false);
    }
  }

  const actionsDisabled = !ownedStore.isPublished || !qrDataUrl;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col items-center gap-3">
          {!store.isPublished ? (
            // Static, inert placeholder -- no <img>, no data URL, no encoded
            // payload of any kind while unpublished. CSS alone (opacity/
            // grayscale on the real QR) would still leave a fully scannable
            // PNG sitting in the DOM for "Save image as" to lift.
            <div className="h-60 w-60 rounded-(--radius-card) bg-black/10" aria-hidden="true" />
          ) : qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR ${publicUrl}`} width={240} height={240} />
          ) : qrError ? (
            <p className="err">{QR_FAILED}</p>
          ) : (
            <div className="h-60 w-60 animate-pulse rounded-(--radius-card) bg-black/5" />
          )}

          {!store.isPublished ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="font-bold">{UNPUBLISHED_TITLE}</p>
              <p className="note-plain">{UNPUBLISHED_BODY}</p>
              <Button variant="outline" onClick={() => router.push("/console/settings/store")}>
                {UNPUBLISHED_ACTION}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold">{URL_LABEL}</label>
          <div className="flex flex-wrap items-center gap-2">
            <p className="select-all break-all font-mono text-sm">{publicUrl}</p>
            <Button type="button" variant="outline" onClick={handleCopy} disabled={actionsDisabled}>
              {COPY_LABEL}
            </Button>
          </div>
          {copyStatus === "success" ? (
            <p className="note-plain" role="status">
              {COPY_SUCCESS}
            </p>
          ) : null}
          {copyStatus === "error" ? (
            <p role="alert" className="err">
              {COPY_FAILED}
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <Button type="button" variant="outline" onClick={handleDownloadPng} disabled={actionsDisabled}>
            {DOWNLOAD_PNG_LABEL}
          </Button>

          <hr className="hair" />

          <label className="text-sm font-bold">{PRINT_SECTION_LABEL}</label>
          <div role="radiogroup" aria-label={PRINT_SECTION_LABEL} className="flex gap-2">
            {PRINT_SIZE_ORDER.map((size) => (
              <Button
                key={size}
                type="button"
                variant={size === printSize ? "primary" : "outline"}
                role="radio"
                aria-checked={size === printSize}
                onClick={() => setPrintSize(size)}
              >
                {SIZE_LABELS[size]}
              </Button>
            ))}
          </div>
          <Button type="button" onClick={handleDownloadPdf} loading={pdfBusy} disabled={actionsDisabled || pdfBusy}>
            {DOWNLOAD_PDF_LABEL}
          </Button>
          {pdfError ? (
            <p role="alert" className="err">
              {PRINT_FAILED}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
