// WBS 4.7 — Thai copy for /console/settings/subscription. Sourced verbatim
// from docs/design/state_matrix.md's "แผนการใช้งาน" section (added in this
// change — no prototype screen exists for this route, same posture as WBS
// 4.6's own "ลิงก์ร้านและ QR" section). Do not paraphrase any of it.
import type { FeatureFlag } from "@brewledger/shared/dist/features";
import type { SubscriptionTier } from "@brewledger/shared/dist/merchant";

export const PAGE_TITLE = "แผนการใช้งาน";

export const CURRENT_PLAN_PREFIX = "แผนปัจจุบัน";

export const ALWAYS_AVAILABLE_NOTE =
  "ขายและรับเงินได้ครบทุกฟังก์ชันในทุกแผน ไม่มีการล็อกฟีเจอร์การขายไว้";

export const TIER_LABEL_TH: Record<SubscriptionTier, string> = {
  free: "ฟรี",
  starter: "สตาร์ทเตอร์",
  growth: "โกรท",
  scale: "สเกล",
};

export const GROUP_HEADING_TH: Record<SubscriptionTier, string> = {
  free: "รวมในทุกแผน",
  starter: "เริ่มใช้ได้ตั้งแต่แผนสตาร์ทเตอร์",
  growth: "เร็ว ๆ นี้ในแผนโกรท",
  scale: "เร็ว ๆ นี้ในแผนสเกล",
};

export const UPGRADE_BENEFIT_TH: Partial<Record<SubscriptionTier, string>> = {
  starter: "อัปเกรดเป็นแผนสตาร์ทเตอร์เพื่อดูต้นทุนต่อแก้วและรับแจ้งเตือนเมื่อราคาวัตถุดิบเปลี่ยน",
  growth: "แผนโกรทกำลังพัฒนาอยู่ จะช่วยพยากรณ์กระแสเงินสดและแนะนำการตั้งราคาด้วย AI",
  scale: "แผนสเกลกำลังพัฒนาอยู่ จะรองรับหลายสาขา ชุดเครื่องมือภาษี และช่องทางดูแลลูกค้าแบบเร่งด่วน",
};

export const COMING_SOON_TAG = "เร็ว ๆ นี้";
export const INCLUDED_TAG = "รวมอยู่แล้ว";

export const FEATURE_LABEL_TH: Record<FeatureFlag, string> = {
  preorder_pickup: "สั่งล่วงหน้าและนัดรับที่ร้าน",
  promptpay_payment: "รับเงินผ่านพร้อมเพย์",
  order_queue: "จัดการคิวและสถานะออเดอร์",
  cash_sale: "บันทึกการขายหน้าร้าน",
  daily_revenue_total: "ยอดขายรวมรายวัน",
  menu_management: "จัดการเมนู",
  store_settings: "ตั้งค่าร้าน",
  unit_costing: "คำนวณต้นทุนต่อหน่วย",
  cost_drift_alerts: "แจ้งเตือนต้นทุนเปลี่ยนแปลง",
  ingredient_stock_tracking: "ติดตามวัตถุดิบและสต๊อก",
  cashflow_forecast: "พยากรณ์กระแสเงินสด",
  ai_advisor: "ที่ปรึกษา AI",
  multi_branch: "จัดการหลายสาขา",
  tax_suite: "ชุดเครื่องมือภาษี",
  priority_support: "ช่องทางดูแลลูกค้าแบบเร่งด่วน",
};
