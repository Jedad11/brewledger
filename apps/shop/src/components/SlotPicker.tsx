"use client";

import * as React from "react";
import { Input, Button } from "@brewledger/ui";
import { fetchPublicSlots, type PublicSlot } from "@/lib/publicApi";
import { groupSlotsByHour } from "@/lib/storeSchedule";
import {
  CHECKOUT_ALL_FULL_TITLE,
  CHECKOUT_CTA_LABEL,
  CUSTOMER_NAME_ERROR,
  CUSTOMER_NAME_LABEL,
  CUSTOMER_NAME_PLACEHOLDER,
  checkoutAllFullBody,
  checkoutSlotTakenTitle,
  checkoutSummaryLabel,
  remainingLabel,
  CHECKOUT_SLOT_TAKEN_BODY,
} from "@/lib/copy";

// WBS 5.3 — the "customer picker" deliverable
// (docs/design/state_matrix.md "เลือกเวลารับ /checkout"). A client
// component (not folded into the server page) because slot selection,
// name entry, and the "slot taken while typing" re-check are all local
// interaction state with no server round trip until the CTA is pressed —
// same reasoning MenuList.tsx documents for going client-side.
//
// This component does NOT call reserve_pickup_slot (WBS 5.3's atomic
// reservation primitive, packages/db/migrations/0028) — not only because
// reserving on mere SELECTION, before the customer has committed to an
// order, would burn real capacity against browses that never convert (the
// same failure mode WBS 5.2's cart design already rejected for order
// rows), but because that primitive is deliberately NOT reachable from the
// browser at all: it is service_role-only (redline_reviewer CRITICAL
// finding on an earlier draft of this migration — granting it to anon let
// any unauthenticated caller exhaust a store's whole capacity with no order
// and no release path, since WBS 5.7/5.11 don't exist yet to free a stale
// hold). The CTA below only re-validates against the read-only public-slots
// list; the real reservation happens server-side inside order creation
// (WBS 5.4's public-create-order, which will call reserve_pickup_slot with
// a service_role client as one step of its own transaction, per the WBS 5.4
// pseudocode) — not built yet, so the CTA's success path is a documented
// stub. See this file's own handleSubmit for exactly where that wiring
// lands.
export function SlotPicker({ slug, timezone, initialSlots }: { slug: string; timezone: string; initialSlots: PublicSlot[] }) {
  const [slots, setSlots] = React.useState(initialSlots);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [taken, setTaken] = React.useState<{ hhmm: string } | null>(null);
  const [checking, setChecking] = React.useState(false);

  const groups = React.useMemo(() => groupSlotsByHour(slots, timezone), [slots, timezone]);
  const selectedSlot = slots.find((s) => s.id === selectedId) ?? null;
  const allFull = slots.length === 0;
  const canSubmit = !!selectedSlot && name.trim().length > 0;

  function handleSelect(slotId: string) {
    setTaken(null);
    setSelectedId(slotId);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!selectedSlot || name.trim().length === 0 || checking) return;

    // "Slot taken while typing" — re-fetch fresh availability before
    // treating the pick as final, since public-slots was last read whenever
    // this page rendered / last refreshed, and could be stale by the time
    // the customer finishes typing their name (interaction_spec.md: "Slot
    // capacity → re-fetched on entering /checkout, and revalidated on
    // submit").
    setChecking(true);
    const result = await fetchPublicSlots(slug);
    setChecking(false);
    if (result.kind !== "ok") return;

    setSlots(result.data);
    const stillAvailable = result.data.some((s) => s.id === selectedSlot.id);
    if (!stillAvailable) {
      setTaken({ hhmm: selectedSlot.slotStart.slice(11, 16) });
      setSelectedId(null);
      return;
    }

    // WBS 5.4 (public-create-order) wires the real submit here — it
    // reserves this exact slot (WBS 5.3's reserve_pickup_slot) as one step
    // of creating the order, then navigates to /pay. Neither exists yet,
    // so there is deliberately no navigation call in this file to a route
    // that doesn't exist.
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {taken ? (
        <div className="cw-notice">
          <b>{checkoutSlotTakenTitle(taken.hhmm)}</b>
          <p>{CHECKOUT_SLOT_TAKEN_BODY}</p>
        </div>
      ) : null}

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
      </div>

      <div className="cw-cartbar">
        <span className="cw-sum">{checkoutSummaryLabel(selectedSlot?.slotStart.slice(11, 16) ?? null)}</span>
        <Button type="submit" loading={checking} disabled={!canSubmit || allFull}>
          {CHECKOUT_CTA_LABEL}
        </Button>
      </div>
    </form>
  );
}
