"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Button, EmptyState, OnboardingStrip, MoneyValue, type OnboardingStripProps } from "@brewledger/ui";
import { toggleMenuItemAvailability, reorderMenuItems, type AvailabilityValue } from "./actions";

export interface MenuListItem {
  id: string;
  name: string;
  priceSatang: number;
  availability: string;
  imageUrl: string | null;
}

const NO_STORE_TITLE = "ตั้งค่าข้อมูลร้านก่อนเพิ่มเมนู";
const NO_STORE_BODY = "กรอกชื่อร้านกับที่อยู่รับสินค้าไว้ก่อน แล้วค่อยกลับมาเพิ่มเมนูได้เลย";
const NO_STORE_ACTION = "ไปตั้งค่าข้อมูลร้าน";
const EMPTY_TITLE = "ยังไม่มีรายการในเมนู";
const EMPTY_BODY = "ใส่ชื่อกับราคาก็ขายได้แล้ว ใช้เวลาไม่ถึงหนึ่งนาที";
const EMPTY_ACTION = "เพิ่มรายการแรก";
const ADD_ITEM = "เพิ่มรายการ";
const AVAILABLE_LABEL = "พร้อมขาย";

export function MenuListClient({
  storeId,
  items: initialItems,
  onboarding,
}: {
  storeId: string | null;
  items: MenuListItem[];
  onboarding: { store: boolean; menu: boolean; payments: boolean };
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(initialItems);
  const [error, setError] = React.useState<string | null>(null);

  const steps: OnboardingStripProps["steps"] = [
    { id: "store", done: onboarding.store },
    { id: "menu", done: onboarding.menu },
    { id: "payments", done: onboarding.payments },
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

  // Narrowed once, textually after the `if (!storeId) return ...` above --
  // TS's control-flow narrowing of a captured outer parameter doesn't cross
  // into a nested function declaration, so the two handlers below close over
  // this local `const` (definitely `string`) rather than the `string | null`
  // prop directly.
  const ownedStoreId: string = storeId;

  async function handleToggle(item: MenuListItem, checked: boolean) {
    const next: AvailabilityValue = checked ? "available" : "hidden";
    const previous = items;
    setError(null);
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, availability: next } : i)));

    const result = await toggleMenuItemAvailability(ownedStoreId, item.id, next);
    if ("error" in result) {
      setItems(previous);
      setError(result.error);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const previous = items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setError(null);
    setItems(next);

    const result = await reorderMenuItems(ownedStoreId, next.map((i) => i.id));
    if ("error" in result) {
      setItems(previous);
      setError(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <OnboardingStrip steps={steps} />

      {error ? (
        <p role="alert" className="err">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title={EMPTY_TITLE}
          body={EMPTY_BODY}
          action={{ label: EMPTY_ACTION, onPress: () => router.push("/console/menu/new") }}
        />
      ) : (
        <>
          <p className="note-plain">{items.length} รายการ</p>
          <Card>
            <div className="flex flex-col gap-3">
              {items.map((item, index) => (
                <div key={item.id} className="flex items-center gap-3 border-b border-black/5 pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="quiet"
                      aria-label="ย้ายขึ้น"
                      disabled={index === 0}
                      onClick={() => handleMove(index, -1)}
                    >
                      ▲
                    </Button>
                    <Button
                      variant="quiet"
                      aria-label="ย้ายลง"
                      disabled={index === items.length - 1}
                      onClick={() => handleMove(index, 1)}
                    >
                      ▼
                    </Button>
                  </div>

                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-(--radius-input) object-cover"
                    />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded-(--radius-input) bg-black/5" aria-hidden="true" />
                  )}

                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                    onClick={() => router.push(`/console/menu/${item.id}`)}
                  >
                    <b className="truncate leading-normal">{item.name}</b>
                    <MoneyValue value={item.priceSatang} role="plain" size="sm" />
                  </button>

                  {/* Bare switch, no visible label -- matches console-setup.js's
                      scMenu() row control exactly (role=switch, aria-label
                      only). packages/ui's Toggle always renders its label
                      visibly (by design, for labelled settings rows like the
                      store publish switch), which would repeat "พร้อมขาย" as
                      bold text on every row here -- the prototype (design
                      precedence rank 5) shows a bare switch for this exact
                      control, so this reuses the same .oc-sw/-track/-thumb
                      classes Toggle itself renders, just without Toggle's
                      wrapper. Still the tap-min-height class from the WBS 4.3
                      redline fix, not a one-off size. */}
                  <button
                    type="button"
                    className={`oc-sw${item.availability === "available" ? " is-on" : ""}`}
                    role="switch"
                    aria-checked={item.availability === "available"}
                    aria-label={AVAILABLE_LABEL}
                    onClick={() => handleToggle(item, item.availability !== "available")}
                  >
                    <span className="oc-sw-track">
                      <span className="oc-sw-thumb" />
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </Card>
          <Button variant="primary" wet onClick={() => router.push("/console/menu/new")}>
            {ADD_ITEM}
          </Button>
        </>
      )}
    </div>
  );
}
