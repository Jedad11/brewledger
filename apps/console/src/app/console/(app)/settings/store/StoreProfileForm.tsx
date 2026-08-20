"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Button, Toggle, OnboardingStrip, type OnboardingStripProps } from "@brewledger/ui";
import { generateSlugBase, slugify } from "@/lib/slug";
import { saveStoreProfile, type StoreProfileInput } from "./actions";
import { PUBLISH_REQUIRES_PROMPTPAY_VERIFICATION } from "./copy";

// WBS 4.3 — store profile screen. Field set and copy: docs/design/state_matrix.md
// "ข้อมูลร้าน /console/settings/store" (added in this change, see
// docs/design/gaps.md GAP-5) and console-setup.js's scStore(). Deliberately
// bundles the publish toggle into the same single "บันทึก" submit as every
// other field, rather than persisting it the instant it's flipped: the
// prototype's own toggle handler only mutates its local demo state (no
// distinct save call), interaction_spec.md doesn't classify this control
// either way, and one save action for the whole form is simpler and can't
// unpublish a live store from a stray tap with nothing to undo.
type StoreProfileRow = {
  id: string;
  name: string;
  pickup_address: string | null;
  opens_at: string | null;
  closes_at: string | null;
  slug: string;
  is_published: boolean;
  promptpay_verified_at: string | null;
} | null;

const SLUG_NOTE_PREFIX = "ลูกค้าจะเข้าที่ ";
const SLUG_NOTE_SUFFIX = " · ตั้งจากชื่อร้านให้อัตโนมัติ แก้ได้ตามต้องการ";
const PUBLISH_LABEL = "เปิดให้ลูกค้าสั่งผ่านลิงก์";
const PUBLISH_DESCRIPTION =
  "เมื่อเปิด ใครก็ตามที่มีลิงก์หรือสแกน QR จะเห็นเมนูและสั่งล่วงหน้าได้ · เมื่อปิด ลิงก์จะแจ้งว่ายังไม่เปิดรับออเดอร์ และคุณยังขายหน้าร้านได้ตามปกติ";

function toTimeInputValue(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

export function StoreProfileForm({
  store,
  onboarding,
}: {
  store: StoreProfileRow;
  onboarding: { store: boolean; menu: boolean; payments: boolean };
}) {
  const router = useRouter();
  const [name, setName] = React.useState(store?.name ?? "");
  const [pickupAddress, setPickupAddress] = React.useState(store?.pickup_address ?? "");
  const [opensAt, setOpensAt] = React.useState(toTimeInputValue(store?.opens_at ?? null));
  const [closesAt, setClosesAt] = React.useState(toTimeInputValue(store?.closes_at ?? null));
  const [slug, setSlug] = React.useState(store?.slug ?? "");
  const [slugTouched, setSlugTouched] = React.useState(!!store);
  const [isPublished, setIsPublished] = React.useState(store?.is_published ?? false);
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(generateSlugBase(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(value);
  }

  function handleSlugBlur() {
    if (slugify(slug).length === 0) {
      setSlug(generateSlugBase(name));
    }
  }

  const canSubmit = name.trim().length > 0 && pickupAddress.trim().length > 0 && !!opensAt && !!closesAt;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || saving) return;

    setSaving(true);
    setError(null);
    setSavedAt(null);

    const input: StoreProfileInput = {
      storeId: store?.id ?? null,
      name,
      pickupAddress,
      opensAt,
      closesAt,
      slug: slugify(slug) || generateSlugBase(name),
      isPublished,
    };

    const result = await saveStoreProfile(input);
    setSaving(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setSlug(result.store.slug);
    setSlugTouched(true);
    setSavedAt(Date.now());
  }

  const steps: OnboardingStripProps["steps"] = [
    { id: "store", done: onboarding.store },
    { id: "menu", done: onboarding.menu },
    { id: "payments", done: onboarding.payments },
  ];

  return (
    <div className="flex flex-col gap-4">
      <OnboardingStrip steps={steps} />
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            label="ชื่อร้าน"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            error={touched && name.trim().length === 0 ? "กรอกชื่อร้าน" : undefined}
          />
          <Input
            label="ที่อยู่สำหรับรับสินค้า"
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            error={
              touched && pickupAddress.trim().length === 0
                ? "กรอกที่อยู่สำหรับรับสินค้า"
                : undefined
            }
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="เวลาเปิด"
              type="time"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
              error={touched && !opensAt ? "เลือกเวลาเปิด" : undefined}
            />
            <Input
              label="เวลาปิด"
              type="time"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              error={touched && !closesAt ? "เลือกเวลาปิด" : undefined}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              label="ลิงก์ร้าน"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              onBlur={handleSlugBlur}
            />
            <p className="note-plain">
              {SLUG_NOTE_PREFIX}
              {/* `slug` state is already kept in sync by handleNameChange /
                  handleSlugChange / handleSlugBlur -- this only normalises
                  it for display. Deliberately NOT generateSlugBase(name)
                  here: that function's empty-input fallback draws a fresh
                  random suffix, which would make the preview change on
                  every unrelated re-render (e.g. toggling publish) while
                  the name field is still blank. */}
              <b>brewledger.app/s/{slugify(slug) || "…"}</b>
              {SLUG_NOTE_SUFFIX}
            </p>
          </div>

          <hr className="hair" />

          <Toggle
            label={PUBLISH_LABEL}
            description={PUBLISH_DESCRIPTION}
            checked={isPublished}
            onChange={setIsPublished}
          />
          {/* Persistent, not only shown after a failed save attempt --
              WBS 4.5 acceptance: "the console says why in plain Thai,"
              and the toggle itself is never disabled to enforce this. */}
          {!onboarding.payments ? (
            <p className="note-plain">
              {PUBLISH_REQUIRES_PROMPTPAY_VERIFICATION}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => router.push("/console/settings/payments")}
              >
                ไปตั้งค่าการรับเงิน
              </button>
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="err">
              {error}
            </p>
          ) : null}
          {savedAt && !error ? (
            <p className="note-plain" role="status">
              บันทึกแล้ว
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
