// WBS 4.7 — Thai copy for /console/settings/subscription. Card-based design
// per explicit product-owner override (2026-08-23): docs/design/state_matrix.md
// originally described a feature-comparison-table layout, authored under the
// wrong assumption that this screen has no prototype counterpart. It does —
// design/console-setup.js's scPlan() (PLANS + the .oc-plans grid) — missed in
// the P5 Handoff.md -> state_matrix.md extraction, same class of gap as GAP-1.
// This file now sources plan name/price/description verbatim from that
// function's PLANS array, mapped by position onto the real 4-value
// subscription_tier enum (free/starter/growth/scale — unchanged, display-only
// change). Do not paraphrase any of it.
import type { SubscriptionTier } from "@brewledger/shared/dist/merchant";

export const PAGE_TITLE = "แผนการใช้งาน";

export const CURRENT_PLAN_LABEL = "แพ็กเกจปัจจุบัน";

// RL-2: this statement holds on every tier including free, so it is rendered
// once, unconditionally, never gated by subscriptionTier.
export const ALWAYS_AVAILABLE_NOTE =
  "ขายและรับเงินได้ครบทุกฟังก์ชันในทุกแผน ไม่มีการล็อกฟีเจอร์การขายไว้";

// WBS 4.8 — RL-1: the gateway is gone, so no per-transaction fee is ever
// attributable to BrewLedger. The parenthetical is not hedging, it is
// accurate: a customer's own bank may charge under normal PromptPay rules,
// and that was never ours to begin with.
export const FEE_STATEMENT_TH =
  "ไม่มีค่าธรรมเนียมต่อรายการ ลูกค้าโอนเข้าพร้อมเพย์ของร้านโดยตรง " +
  "(ธนาคารของลูกค้าอาจคิดค่าธรรมเนียมตามเงื่อนไขพร้อมเพย์ปกติ ซึ่งไม่เกี่ยวกับ BrewLedger)";

export interface PlanDisplay {
  name: string;
  price: string;
  description: string;
}

// Verbatim from design/console-setup.js's PLANS array (line 116), mapped by
// position onto the unchanged subscription_tier enum: free/starter/growth/scale
// stand in for the prototype's free/starter/pro/multi keys respectively.
export const PLAN_DISPLAY: Record<SubscriptionTier, PlanDisplay> = {
  free: {
    name: "ทดลองใช้",
    price: "฿0",
    description: "ออเดอร์ 50 รายการ/เดือน · เมนูไม่จำกัด",
  },
  starter: {
    name: "เริ่มต้น",
    price: "฿199/เดือน",
    description: "ออเดอร์ไม่จำกัด · รายงานกำไรรายวัน",
  },
  growth: {
    name: "ร้านประจำ",
    price: "฿449/เดือน",
    description: "สแกนบิลอัตโนมัติ · กำไรต่อเมนู · คลังวัตถุดิบ",
  },
  scale: {
    name: "หลายสาขา",
    price: "฿990/เดือน",
    description: "จัดการหลายสาขา · รายงานรวม · ผู้ใช้หลายคน",
  },
};

export const PLAN_ORDER: SubscriptionTier[] = ["free", "starter", "growth", "scale"];

export const CURRENT_PLAN_TAG = "ใช้อยู่";
export const SELECT_PLAN_LABEL = "เลือกแพ็กเกจนี้";

export const UPGRADE_CARD_HEADING = "อัปเกรดแล้วได้อะไรเพิ่ม";

// Verbatim from scPlan()'s upgrade-benefit row list.
export const UPGRADE_ROWS: readonly string[] = [
  "สแกนบิลผู้ขายแล้วเก็บต้นทุนอัตโนมัติ",
  "รายงานกำไรต่อเมนู เรียงตามกำไรรวม",
  "คลังวัตถุดิบและวันที่ของจะหมด",
  "ผู้ใช้หลายคนต่อร้าน",
];
