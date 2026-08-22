"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, EmptyState } from "@brewledger/ui";
import type { BaseUnit } from "@brewledger/costing/dist/units";

export interface IngredientListItem {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  /** null = no confirmed purchase yet (RL-2: never "0"). */
  costLabel: string | null;
  stockLabel: string;
  isNegative: boolean;
  /** null = not enough sale history to estimate (see 0036's own comment —
   * genuinely absent until WBS 6.8 starts writing 'sale' ledger rows, not a
   * bug). */
  daysOfCover: number | null;
  lastPurchaseLabel: string;
}

// Copy verbatim from docs/design/state_matrix.md's "คลังวัตถุดิบ
// /console/inventory" section — do not paraphrase.
const TITLE = "คลังวัตถุดิบ";
const EMPTY_TITLE = "ยังไม่มีวัตถุดิบในระบบ";
const EMPTY_BODY = "ส่วนนี้ไม่จำเป็นต้องใช้ก็ขายได้ตามปกติ เปิดใช้เมื่อไหร่ก็ได้ที่สะดวก";
const NEGATIVE_NOTE = "น่าจะยังไม่ได้บันทึกบิลซื้อ";
const ADD_INGREDIENT = "เพิ่มวัตถุดิบ";
const SEARCH_PLACEHOLDER = "ค้นหาวัตถุดิบ";
const NO_STORE_TITLE = "ตั้งค่าข้อมูลร้านก่อนเพิ่มวัตถุดิบ";
const NO_STORE_BODY = "กรอกชื่อร้านกับที่อยู่รับสินค้าไว้ก่อน แล้วค่อยกลับมาที่นี่ได้เลย";
const NO_STORE_ACTION = "ไปตั้งค่าข้อมูลร้าน";

type SortKey = "name" | "stock";

export function IngredientListClient({
  storeId,
  items,
}: {
  storeId: string | null;
  items: IngredientListItem[];
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("name");

  if (!storeId) {
    return (
      <EmptyState
        title={NO_STORE_TITLE}
        body={NO_STORE_BODY}
        action={{ label: NO_STORE_ACTION, onPress: () => router.push("/console/settings/store") }}
      />
    );
  }
  const filtered = items.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "stock") {
      const aNum = parseFloat(a.stockLabel);
      const bNum = parseFloat(b.stockLabel);
      return aNum - bNum; // lowest stock first — surfaces what needs a purchase
    }
    return a.name.localeCompare(b.name, "th");
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="oc-top flex items-center justify-between gap-3">
        <div>
          <h1>{TITLE}</h1>
          {items.length > 0 ? <p className="note-plain">{items.length} รายการ</p> : null}
        </div>
        <Button variant="primary" onClick={() => router.push("/console/inventory/new")}>
          {ADD_INGREDIENT}
        </Button>
      </header>

      {items.length === 0 ? (
        <EmptyState title={EMPTY_TITLE} body={EMPTY_BODY} />
      ) : (
        <>
          <Input
            placeholder={SEARCH_PLACEHOLDER}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={SEARCH_PLACEHOLDER}
          />
          <div className="flex gap-2">
            <Button variant={sortKey === "name" ? "dark" : "quiet"} onClick={() => setSortKey("name")}>
              เรียงตามชื่อ
            </Button>
            <Button variant={sortKey === "stock" ? "dark" : "quiet"} onClick={() => setSortKey("stock")}>
              สต๊อกน้อยสุดก่อน
            </Button>
          </div>

          <Card>
            <div className="oc-invrows">
              {sorted.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="oc-invrow w-full text-left"
                  onClick={() => router.push(`/console/inventory/${item.id}`)}
                >
                  <div>
                    <b>{item.name}</b>
                    <p className="note-plain">
                      {item.costLabel ?? "—"} · ซื้อล่าสุด {item.lastPurchaseLabel}
                    </p>
                  </div>
                  <div className="oc-invright">
                    <b className="num">{item.stockLabel}</b>
                    {item.isNegative ? (
                      <span className="note-plain">{NEGATIVE_NOTE}</span>
                    ) : item.daysOfCover !== null ? (
                      <span className={item.daysOfCover <= 2 ? "oc-lowdays" : "note-plain"}>
                        เหลือพอราว {item.daysOfCover} วัน
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
