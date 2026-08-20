"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input, Button, PublicMoneyValue } from "@brewledger/ui";
import { fetchPublicSlots, createOrder, type PublicSlot } from "@/lib/publicApi";
import { groupSlotsByHour } from "@/lib/storeSchedule";
import { useCart, cartLineTotalSatang, cartTotalSatang, type CartLine } from "@/lib/cart";
import type { CartDiffReason } from "@/lib/cartValidation";
import { CartDiffNotices } from "@/components/CartDiffNotices";
import {
  CHECKOUT_ALL_FULL_TITLE,
  CHECKOUT_CTA_LABEL,
  CUSTOMER_NAME_ERROR,
  CUSTOMER_NAME_LABEL,
  CUSTOMER_NAME_PLACEHOLDER,
  CUSTOMER_PHONE_LABEL,
  CUSTOMER_PHONE_OPTIONAL_TAG,
  CUSTOMER_PHONE_PLACEHOLDER,
  CART_SUMMARY_TITLE,
  CART_TOTAL_LABEL,
  ORDER_CREATE_FAILED,
  checkoutAllFullBody,
  checkoutSlotTakenTitle,
  checkoutSummaryLabel,
  remainingLabel,
  CHECKOUT_SLOT_TAKEN_BODY,
} from "@/lib/copy";

function optionLabel(options: { name: string }[]): string {
  return options.map((option) => option.name).join(" · ");
}

// WBS 5.3/5.4 — the "customer picker" deliverable
// (docs/design/state_matrix.md "เลือกเวลารับ /checkout"). A client
// component (not folded into the server page) because slot selection,
// name/phone entry, the "slot taken while typing" re-check, and the real
// order-creation submit are all local interaction state with no server
// round trip until the CTA is pressed — same reasoning MenuList.tsx
// documents for going client-side.
//
// This component does NOT call reserve_pickup_slot (WBS 5.3's atomic
// reservation primitive) directly — that primitive is service_role-only and
// only ever runs INSIDE checkout_create_order's own transaction
// (packages/db/migrations/0029_checkout_order_creation.sql), reached here
// only via the public-create-order Edge Function (createOrder in
// publicApi.ts). Reserving on mere SELECTION, before the customer has
// committed to an order, would burn real capacity against browses that
// never convert — the same failure mode WBS 5.2's cart design already
// rejected for order rows.
//
// WBS 5.4 CLOSES the WBS 5.3-era boundary that used to live in this file's
// own header comment ("do not import apps/shop/lib/cart.ts... that
// boundary is deliberate") — order creation needs the cart's lines to
// submit, so this component now reads the cart directly via useCart(slug).
export function SlotPicker({ slug, timezone, initialSlots }: { slug: string; timezone: string; initialSlots: PublicSlot[] }) {
  const router = useRouter();
  const { lines, updateLine, removeLine, clearCart } = useCart(slug);

  const [slots, setSlots] = React.useState(initialSlots);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [taken, setTaken] = React.useState<{ hhmm: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [diffs, setDiffs] = React.useState<CartDiffReason[] | null>(null);
  const [orderFailed, setOrderFailed] = React.useState(false);

  const groups = React.useMemo(() => groupSlotsByHour(slots, timezone), [slots, timezone]);
  const selectedSlot = slots.find((s) => s.id === selectedId) ?? null;
  const allFull = slots.length === 0;
  const canSubmit = !!selectedSlot && name.trim().length > 0 && lines.length > 0;
  const total = cartTotalSatang(lines);

  function handleSelect(slotId: string) {
    setTaken(null);
    setOrderFailed(false);
    setSelectedId(slotId);
  }

  async function submitOrder(pickupSlotId: string, cartLines: CartLine[]) {
    setBusy(true);
    setOrderFailed(false);
    const result = await createOrder({
      storeSlug: slug,
      cart: cartLines.map((line) => ({
        menuItemId: line.menuItemId,
        nameSnapshot: line.nameSnapshot,
        unitPriceSatang: line.unitPriceSatang,
        quantity: line.quantity,
        options: line.options.map((option) => ({
          groupId: option.groupId,
          optionId: option.optionId,
          name: option.name,
          deltaSatang: option.deltaSatang,
        })),
      })),
      pickupSlotId,
      customerName: name.trim(),
      customerPhone: phone.trim() || undefined,
    });

    if (result.kind === "created") {
      clearCart();
      // /s/{slug}/pay/{code} is WBS 5.5, not built yet — documented forward
      // reference, same precedent WBS 4.6's own PROGRESS.md row already set
      // for navigating to a route ahead of the entry that builds it.
      router.push(`/s/${slug}/pay/${result.data.orderCode}`);
      return;
    }

    setBusy(false);

    if (result.kind === "price_mismatch") {
      setDiffs(result.diffs);
      return;
    }
    if (result.kind === "slot_full") {
      // Reuse the EXISTING "slot taken while typing" notice — same concept,
      // just discovered at submit time instead of at the pre-check below.
      setSlots(result.slots);
      setSelectedId(null);
      setTaken({ hhmm: selectedSlot?.slotStart.slice(11, 16) ?? "" });
      return;
    }
    setOrderFailed(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!selectedSlot || name.trim().length === 0 || lines.length === 0 || busy) return;

    setBusy(true);
    setOrderFailed(false);
    // "Slot taken while typing" — re-fetch fresh availability before
    // treating the pick as final, since public-slots was last read whenever
    // this page rendered / last refreshed, and could be stale by the time
    // the customer finishes typing their name (interaction_spec.md: "Slot
    // capacity → re-fetched on entering /checkout, and revalidated on
    // submit").
    const result = await fetchPublicSlots(slug);
    if (result.kind !== "ok") {
      setBusy(false);
      setOrderFailed(true);
      return;
    }

    setSlots(result.data);
    const stillAvailable = result.data.some((s) => s.id === selectedSlot.id);
    if (!stillAvailable) {
      setBusy(false);
      setTaken({ hhmm: selectedSlot.slotStart.slice(11, 16) });
      setSelectedId(null);
      return;
    }

    await submitOrder(selectedSlot.id, lines);
  }

  // Diff resolution (accept a new price / remove a line) applies the fix to
  // the persisted cart via updateLine/removeLine (sessionStorage + every
  // subscriber, including the /cart page if the customer goes back), AND
  // computes the same next-lines array locally to retry the submit
  // immediately — passed explicitly to submitOrder rather than read back off
  // `lines`, which only reflects the change on the NEXT render
  // (useSyncExternalStore). This keeps "resolving a diff proceeds
  // automatically" (interaction_spec.md) without a setState-in-effect
  // cascade.
  function acceptDiff(diff: CartDiffReason) {
    const nextLines = lines.map((line, i) => {
      if (i !== diff.lineIndex) return line;
      if (diff.kind === "price_changed") return { ...line, unitPriceSatang: diff.newSatang };
      if (diff.kind === "option_price_changed") {
        return {
          ...line,
          options: line.options.map((option) =>
            option.optionId === diff.optionId ? { ...option, deltaSatang: diff.newSatang } : option,
          ),
        };
      }
      return line;
    });
    updateLine(diff.lineIndex, () => nextLines[diff.lineIndex]);
    setDiffs(null);
    if (selectedSlot) void submitOrder(selectedSlot.id, nextLines);
  }

  function removeDiffLine(lineIndex: number) {
    const nextLines = lines.filter((_, i) => i !== lineIndex);
    removeLine(lineIndex);
    setDiffs(null);
    if (selectedSlot && nextLines.length > 0) void submitOrder(selectedSlot.id, nextLines);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {taken ? (
        <div className="cw-notice">
          <b>{checkoutSlotTakenTitle(taken.hhmm)}</b>
          <p>{CHECKOUT_SLOT_TAKEN_BODY}</p>
        </div>
      ) : null}

      {orderFailed ? (
        <div className="cw-notice">
          <b>{ORDER_CREATE_FAILED}</b>
        </div>
      ) : null}

      {diffs ? <CartDiffNotices diffs={diffs} onAccept={acceptDiff} onRemove={removeDiffLine} /> : null}

      {allFull ? (
        <div className="cw-notice">
          <b>{CHECKOUT_ALL_FULL_TITLE}</b>
          <p>{checkoutAllFullBody("พรุ่งนี้")}</p>
        </div>
      ) : (
        groups.map((group) => (
          <div className="cw-slotg" key={group.hourLabel}>
            <h4>{group.hourLabel} น.</h4>
            <div className="cw-slots">
              {group.slots.map((slot) => {
                const label = remainingLabel(slot.remaining);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    className={`cw-slot${selectedId === slot.id ? " is-on" : ""}`}
                    data-slot={slot.id}
                    onClick={() => handleSelect(slot.id)}
                  >
                    <b className="num">{slot.hhmm}</b>
                    {label ? <span className="note-plain">{label}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      <div className="card">
        <Input
          label={CUSTOMER_NAME_LABEL}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={CUSTOMER_NAME_PLACEHOLDER}
          error={touched && name.trim().length === 0 ? CUSTOMER_NAME_ERROR : undefined}
        />
        <div style={{ marginTop: "1.6rem" }}>
          <Input
            label={`${CUSTOMER_PHONE_LABEL} ${CUSTOMER_PHONE_OPTIONAL_TAG}`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={CUSTOMER_PHONE_PLACEHOLDER}
            inputMode="tel"
          />
        </div>
      </div>

      <div className="card">
        <h4>{CART_SUMMARY_TITLE}</h4>
        {lines.map((line, i) => (
          <div className="cw-sumline" key={i}>
            <span>
              {line.nameSnapshot} × {line.quantity}
              <br />
              <span className="note-plain">{optionLabel(line.options)}</span>
            </span>
            <b className="num">
              <PublicMoneyValue value={cartLineTotalSatang(line)} />
            </b>
          </div>
        ))}
        <hr className="hair" />
        <div className="cw-sumline cw-total">
          <span>{CART_TOTAL_LABEL}</span>
          <b className="num">
            <PublicMoneyValue value={total} />
          </b>
        </div>
      </div>

      <div className="cw-cartbar">
        <span className="cw-sum">{checkoutSummaryLabel(selectedSlot?.slotStart.slice(11, 16) ?? null)}</span>
        <Button type="submit" loading={busy} disabled={!canSubmit || allFull}>
          {CHECKOUT_CTA_LABEL}
        </Button>
      </div>
    </form>
  );
}
