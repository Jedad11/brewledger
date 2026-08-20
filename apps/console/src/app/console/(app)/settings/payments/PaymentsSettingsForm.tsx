"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Card, Input, Button, Toggle, EmptyState, OnboardingStrip, type OnboardingStripProps } from "@brewledger/ui";
import { normalizePromptPayId, type PromptPayType } from "@brewledger/shared/dist/promptpay/normalize";
import { buildPromptPayPayload } from "@brewledger/shared/dist/promptpay/generate";
import { savePromptPaySettings, type SavePromptPayInput } from "./actions";

// WBS 4.5 — /console/settings/payments. RL-1 primary enforcement point: the
// live QR preview below the input is the merchant's own verification step
// (scan with their own banking app, see their own name), not a claim in a
// document. Copy here is sourced from docs/design/state_matrix.md's
// "การรับเงิน /console/settings/payments" section, corrected in the same
// change that built this screen -- see that file's header note. Do not
// paraphrase any of it.
const NO_STORE_TITLE = "ตั้งค่าข้อมูลร้านก่อนตั้งค่าการรับเงิน";
const NO_STORE_BODY = "กรอกชื่อร้านกับที่อยู่รับสินค้าไว้ก่อน แล้วค่อยกลับมาตั้งค่าการรับเงินได้เลย";
const NO_STORE_ACTION = "ไปตั้งค่าข้อมูลร้าน";

const TYPE_LABELS: Record<PromptPayType, string> = {
  msisdn: "เบอร์มือถือ",
  nid: "เลขบัตรประชาชน",
  taxid: "เลขผู้เสียภาษี",
};
const TYPE_ORDER: PromptPayType[] = ["msisdn", "nid", "taxid"];
const ID_PLACEHOLDER: Record<PromptPayType, string> = {
  msisdn: "0812345678",
  nid: "1234567890123",
  taxid: "1234567890123",
};

const VERIFY_INSTRUCTION =
  "สแกน QR นี้ด้วยแอปธนาคารของคุณเอง แล้วดูว่าชื่อผู้รับเงินเป็นชื่อคุณถูกต้องหรือไม่ (ยังไม่ต้องกดโอน)";
const PREVIEW_PLACEHOLDER_NOTE = "กรอกและตรวจสอบข้อมูลด้านบนให้ถูกต้องก่อน จึงจะแสดง QR ตัวอย่างที่นี่";
const PREVIEW_FAILED_NOTE = "แสดง QR ตัวอย่างไม่สำเร็จ ลองใหม่อีกครั้ง";
const CONFIRM_LABEL = "ฉันสแกนแล้วและยืนยันว่าชื่อผู้รับเงินคือฉัน";
const EXPLAINER_LINES = [
  "เงินจากลูกค้าโอนเข้าบัญชีพร้อมเพย์ของคุณโดยตรง ไม่ผ่าน BrewLedger",
  "เราเก็บแค่เบอร์พร้อมเพย์ไว้สร้าง QR เท่านั้น ไม่เห็นและไม่เก็บเลขบัญชีธนาคารของคุณ",
  "ไม่มีค่าธรรมเนียมจากเรา",
];
const SAVE_SUCCESS = "บันทึกแล้ว";

// 1.00 THB — non-zero so the preview is a dynamic QR (encodes a locked
// amount, matching what a real order QR will look like), and small enough
// that scanning it in a banking app to check the payee name carries no
// real stakes if a merchant ever went further and confirmed the transfer.
const PREVIEW_AMOUNT_SATANG = 100;

export function PaymentsSettingsForm({
  storeId,
  initial,
  onboarding,
}: {
  storeId: string | null;
  initial: { promptpayId: string | null; promptpayType: PromptPayType | null; promptpayVerifiedAt: string | null };
  onboarding: { store: boolean; menu: boolean };
}) {
  const router = useRouter();

  const [type, setType] = React.useState<PromptPayType>(initial.promptpayType ?? "msisdn");
  const [raw, setRaw] = React.useState(initial.promptpayId ?? "");
  const [confirmed, setConfirmed] = React.useState(!!initial.promptpayVerifiedAt);
  const [paymentsDone, setPaymentsDone] = React.useState(!!initial.promptpayVerifiedAt);

  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [qrError, setQrError] = React.useState(false);

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  const normalized = normalizePromptPayId(type, raw);

  function handleTypeChange(next: PromptPayType) {
    setType(next);
    setConfirmed(false);
    setError(null);
    setSavedAt(null);
    setQrDataUrl(null);
    setQrError(false);
  }

  function handleRawChange(next: string) {
    setRaw(next);
    setConfirmed(false);
    setError(null);
    setSavedAt(null);
    setQrDataUrl(null);
    setQrError(false);
  }

  // Only reachable once normalized.value is set (the effect below bails
  // out before scheduling any async work otherwise), so the stale preview
  // is always cleared imperatively in the change handlers above, not by a
  // synchronous setState branch in the effect body itself.
  React.useEffect(() => {
    if (!normalized.ok || !normalized.value) return;

    let cancelled = false;
    const payload = buildPromptPayPayload({
      promptpayId: normalized.value,
      promptpayType: type,
      amountSatang: PREVIEW_AMOUNT_SATANG,
    });

    QRCode.toDataURL(payload, { margin: 1, width: 240 })
      .then((dataUrl) => {
        if (cancelled) return;
        setQrDataUrl(dataUrl);
        setQrError(false);
      })
      .catch((err) => {
        console.error("promptpay preview QR generation failed", err);
        if (cancelled) return;
        setQrDataUrl(null);
        setQrError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [normalized.ok, normalized.value, type]);

  const steps: OnboardingStripProps["steps"] = [
    { id: "store", done: onboarding.store },
    { id: "menu", done: onboarding.menu },
    { id: "payments", done: paymentsDone },
  ];

  if (!storeId) {
    return (
      <div className="flex flex-col gap-4">
        <OnboardingStrip steps={steps} />
        <EmptyState
          title={NO_STORE_TITLE}
          body={NO_STORE_BODY}
          action={{ label: NO_STORE_ACTION, onPress: () => router.push("/console/settings/store") }}
        />
      </div>
    );
  }

  const ownedStoreId: string = storeId;
  const idError = raw.trim().length > 0 && !normalized.ok ? normalized.error ?? undefined : undefined;
  const canConfirm = normalized.ok && !!qrDataUrl;
  const canSubmit = normalized.ok && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    setSavedAt(null);

    const input: SavePromptPayInput = {
      storeId: ownedStoreId,
      promptpayType: type,
      promptpayIdRaw: raw,
      verified: confirmed,
    };

    const result = await savePromptPaySettings(input);
    setSaving(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setPaymentsDone(!!result.promptpayVerifiedAt);
    setConfirmed(!!result.promptpayVerifiedAt);
    setSavedAt(Date.now());
  }

  return (
    <div className="flex flex-col gap-4">
      <OnboardingStrip steps={steps} />
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold">ประเภทพร้อมเพย์</label>
            <div role="radiogroup" aria-label="ประเภทพร้อมเพย์" className="flex flex-wrap gap-2">
              {TYPE_ORDER.map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={t === type ? "primary" : "outline"}
                  role="radio"
                  aria-checked={t === type}
                  onClick={() => handleTypeChange(t)}
                >
                  {TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
          </div>

          <Input
            label={TYPE_LABELS[type]}
            placeholder={ID_PLACEHOLDER[type]}
            inputMode={type === "msisdn" ? "tel" : "numeric"}
            value={raw}
            onChange={(e) => handleRawChange(e.target.value)}
            error={idError}
            valid={raw.trim().length > 0 && normalized.ok}
          />

          <div className="flex flex-col items-center gap-3 rounded-(--radius-card) border border-black/10 p-4">
            <p className="text-center font-bold leading-normal">{VERIFY_INSTRUCTION}</p>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="ตัวอย่าง QR พร้อมเพย์" width={240} height={240} />
            ) : qrError ? (
              <p className="err">{PREVIEW_FAILED_NOTE}</p>
            ) : (
              <p className="note-plain">{PREVIEW_PLACEHOLDER_NOTE}</p>
            )}
          </div>

          <Toggle
            label={CONFIRM_LABEL}
            checked={confirmed}
            onChange={setConfirmed}
            disabled={!canConfirm}
          />

          <hr className="hair" />

          <div className="flex flex-col gap-1">
            {EXPLAINER_LINES.map((line) => (
              <p key={line} className="note-plain">
                {line}
              </p>
            ))}
          </div>

          {error ? (
            <p role="alert" className="err">
              {error}
            </p>
          ) : null}
          {savedAt && !error ? (
            <p className="note-plain" role="status">
              {SAVE_SUCCESS}
            </p>
          ) : null}

          <Button type="submit" wet loading={saving} disabled={!canSubmit}>
            บันทึก
          </Button>
        </form>
      </Card>
    </div>
  );
}

