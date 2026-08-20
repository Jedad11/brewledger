// Plain constants shared between actions.ts (a "use server" module, which
// may only export async functions -- see actions.ts's own note) and
// StoreProfileForm.tsx (client component).
//
// WBS 4.5 acceptance: "a store with no PromptPay ID cannot be published as
// orderable, and the console says why in plain Thai." The toggle itself is
// never disabled to enforce this -- StoreProfileForm shows this text
// persistently beneath it, and actions.ts returns it verbatim if a save is
// attempted anyway (e.g. a stale page).
export const PUBLISH_REQUIRES_PROMPTPAY_VERIFICATION =
  "เชื่อมและยืนยันการรับเงินผ่านพร้อมเพย์ก่อน จึงจะเปิดขายผ่านลิงก์ได้";
