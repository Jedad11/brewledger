"use client";

import * as React from "react";
import { normalizeThaiPhone, formatThaiPhoneForDisplay } from "@/lib/phone";
import { requestOtp } from "@/lib/requestOtp";
import { OtpInput } from "./OtpInput";
import { verifyOtpAction } from "./actions";

const RESEND_COOLDOWN_SECONDS = 60;
const INVALID_PHONE_ERROR = "กรุณากรอกเบอร์โทรศัพท์มือถือให้ถูกต้อง เช่น 081-234-5678";

type Step = "phone" | "otp";

export function LoginForm({ next }: { next: string | null }) {
  const [step, setStep] = React.useState<Step>("phone");
  const [phoneRaw, setPhoneRaw] = React.useState("");
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [normalizedPhone, setNormalizedPhone] = React.useState<string | null>(null);
  const [otpCode, setOtpCode] = React.useState("");
  const [otpError, setOtpError] = React.useState<string | null>(null);
  const [sendingOtp, setSendingOtp] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);
  const autoSubmittedRef = React.useRef(false);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function sendOtp(phone: string) {
    setSendingOtp(true);
    setPhoneError(null);
    const result = await requestOtp(phone);
    setSendingOtp(false);
    if ("error" in result) {
      setPhoneError(result.error);
      return false;
    }
    setNormalizedPhone(phone);
    setCooldown(RESEND_COOLDOWN_SECONDS);
    return true;
  }

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiPhone(phoneRaw);
    if (!normalized) {
      setPhoneError(INVALID_PHONE_ERROR);
      return;
    }
    const ok = await sendOtp(normalized);
    if (ok) {
      setOtpCode("");
      setOtpError(null);
      autoSubmittedRef.current = false;
      setStep("otp");
    }
  }

  const handleVerify = React.useCallback(
    async (code: string) => {
      if (!normalizedPhone || verifying) return;
      setVerifying(true);
      setOtpError(null);
      const result = await verifyOtpAction(normalizedPhone, code, next);
      // Success calls redirect() inside the action, which never returns here
      // — only a real failure reaches this line.
      setVerifying(false);
      if (result?.error) {
        setOtpError(result.error);
        setOtpCode("");
        autoSubmittedRef.current = false;
      }
    },
    [normalizedPhone, next, verifying],
  );

  React.useEffect(() => {
    if (otpCode.length === 6 && !autoSubmittedRef.current && !verifying) {
      autoSubmittedRef.current = true;
      void handleVerify(otpCode);
    }
  }, [otpCode, verifying, handleVerify]);

  async function handleResend() {
    if (cooldown > 0 || !normalizedPhone || sendingOtp) return;
    setOtpCode("");
    autoSubmittedRef.current = false;
    await sendOtp(normalizedPhone);
  }

  function handleChangeNumber() {
    setStep("phone");
    setOtpCode("");
    setOtpError(null);
    setCooldown(0);
    autoSubmittedRef.current = false;
  }

  if (step === "phone") {
    return (
      <form onSubmit={handlePhoneSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-sm font-medium leading-normal text-ink">
            เบอร์โทรศัพท์
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            placeholder="081-234-5678"
            value={phoneRaw}
            disabled={sendingOtp}
            onChange={(e) => {
              setPhoneRaw(e.target.value);
              if (phoneError) setPhoneError(null);
            }}
            className="min-h-11 w-full rounded-lg border border-ink/20 bg-white px-4 text-base leading-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
          />
          {phoneError ? (
            <p role="alert" className="text-sm leading-normal text-red-600">
              {phoneError}
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={sendingOtp || phoneRaw.trim().length === 0}
          className="min-h-11 w-full rounded-lg bg-brand px-4 text-base font-semibold leading-normal text-white transition-opacity disabled:opacity-50"
        >
          {sendingOtp ? "กำลังส่ง..." : "ส่งรหัส OTP"}
        </button>
      </form>
    );
  }

  const displayPhone = normalizedPhone ? formatThaiPhoneForDisplay(normalizedPhone) : "";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-normal text-ink-muted text-pretty">
        เราส่งรหัส 6 หลักไปที่ {displayPhone} แล้ว
      </p>
      <OtpInput value={otpCode} onChange={setOtpCode} disabled={verifying} autoFocus />
      {otpError ? (
        <p role="alert" className="text-sm leading-normal text-red-600">
          {otpError}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void handleVerify(otpCode)}
        disabled={verifying || otpCode.length !== 6}
        className="min-h-11 w-full rounded-lg bg-brand px-4 text-base font-semibold leading-normal text-white transition-opacity disabled:opacity-50"
      >
        {verifying ? "กำลังตรวจสอบ..." : "ยืนยัน"}
      </button>
      <div className="flex items-center justify-between gap-3 text-sm leading-normal">
        <button
          type="button"
          onClick={handleChangeNumber}
          disabled={verifying}
          className="min-h-11 text-ink-muted underline disabled:opacity-50"
        >
          เปลี่ยนเบอร์โทร
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0 || sendingOtp || verifying}
          className="min-h-11 text-brand disabled:cursor-default disabled:text-ink-muted disabled:no-underline"
        >
          {cooldown > 0 ? `ส่งรหัสอีกครั้งใน ${cooldown} วินาที` : "ส่งรหัสอีกครั้ง"}
        </button>
      </div>
    </div>
  );
}
