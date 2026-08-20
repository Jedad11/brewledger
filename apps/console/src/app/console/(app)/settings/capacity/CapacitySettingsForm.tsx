"use client";

import * as React from "react";
import { Card, Input, Button } from "@brewledger/ui";
import { applyDefaultCapacity, updateSlotCapacity } from "./actions";
import {
  DEFAULT_CAPACITY_APPLY_BUTTON,
  DEFAULT_CAPACITY_LABEL,
  PAGE_INTRO,
  SLOT_CAPACITY_SAVED,
  UPCOMING_SLOTS_EMPTY,
  UPCOMING_SLOTS_TITLE,
  bulkApplySummary,
} from "./copy";

interface SlotRow {
  id: string;
  slot_start: string;
  slot_end: string;
  capacity: number;
  booked_count: number;
}

function formatSlotRange(slotStart: string, slotEnd: string, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("th-TH", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const start = fmt.formatToParts(new Date(slotStart));
  const get = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const endHm = new Intl.DateTimeFormat("th-TH", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(slotEnd));
  return `${get(start, "day")}/${get(start, "month")} ${get(start, "hour")}:${get(start, "minute")}–${endHm}`;
}

function SlotRowEditor({ storeId, slot, timezone }: { storeId: string; slot: SlotRow; timezone: string }) {
  const [capacity, setCapacity] = React.useState(String(slot.capacity));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function handleSave() {
    const parsed = Number(capacity);
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await updateSlotCapacity(storeId, slot.id, parsed);
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/5 py-3 last:border-b-0">
      <div className="flex flex-col">
        <span className="font-medium">{formatSlotRange(slot.slot_start, slot.slot_end, timezone)}</span>
        <span className="note-plain">
          จองแล้ว {slot.booked_count} / {slot.capacity}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          className="input w-20"
          value={capacity}
          onChange={(e) => {
            setCapacity(e.target.value);
            setSaved(false);
          }}
        />
        <Button type="button" loading={saving} onClick={handleSave}>
          บันทึก
        </Button>
      </div>
      {error ? <span className="err">{error}</span> : null}
      {saved && !error ? <span className="note-plain">{SLOT_CAPACITY_SAVED}</span> : null}
    </div>
  );
}

export function CapacitySettingsForm({
  storeId,
  defaultCapacity,
  timezone,
  slots,
}: {
  storeId: string | null;
  defaultCapacity: number;
  timezone: string;
  slots: SlotRow[];
}) {
  const [bulkValue, setBulkValue] = React.useState(String(defaultCapacity));
  const [applying, setApplying] = React.useState(false);
  const [bulkError, setBulkError] = React.useState<string | null>(null);
  const [bulkResult, setBulkResult] = React.useState<{ updated: number; skipped: number } | null>(null);

  async function handleApplyDefault() {
    if (!storeId) return;
    const parsed = Number(bulkValue);
    setApplying(true);
    setBulkError(null);
    setBulkResult(null);
    const result = await applyDefaultCapacity(storeId, parsed);
    setApplying(false);
    if ("error" in result) {
      setBulkError(result.error);
      return;
    }
    setBulkResult({ updated: result.updated, skipped: result.skipped });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="note-plain">{PAGE_INTRO}</p>

      <Card>
        <div className="flex flex-col gap-3">
          <Input
            label={DEFAULT_CAPACITY_LABEL}
            type="number"
            min={1}
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
          />
          {bulkError ? <p className="err">{bulkError}</p> : null}
          {bulkResult && !bulkError ? (
            <p className="note-plain" role="status">
              {bulkApplySummary(bulkResult.updated, bulkResult.skipped)}
            </p>
          ) : null}
          <Button type="button" loading={applying} disabled={!storeId} onClick={handleApplyDefault}>
            {DEFAULT_CAPACITY_APPLY_BUTTON}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{UPCOMING_SLOTS_TITLE}</h2>
        {storeId && slots.length > 0 ? (
          <div className="flex flex-col">
            {slots.map((slot) => (
              <SlotRowEditor key={slot.id} storeId={storeId} slot={slot} timezone={timezone} />
            ))}
          </div>
        ) : (
          <p className="note-plain">{UPCOMING_SLOTS_EMPTY}</p>
        )}
      </Card>
    </div>
  );
}
