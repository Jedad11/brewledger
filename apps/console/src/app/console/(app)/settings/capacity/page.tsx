import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { CapacitySettingsForm } from "./CapacitySettingsForm";
import { PAGE_TITLE } from "./copy";
import type { Database } from "@brewledger/db/types";

type PickupSlotRow = Pick<
  Database["public"]["Tables"]["pickup_slots"]["Row"],
  "id" | "slot_start" | "slot_end" | "capacity" | "booked_count"
>;

export default async function CapacitySettingsPage() {
  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  // storeId is resolved once, in lib/merchant.ts's currentStoreId(), so this
  // screen can't disagree with settings/store (or any other console page)
  // about which stores row is current when a merchant has more than one --
  // see that helper's header comment.
  const storeId = currentStoreId(merchant);

  const supabase = await createClient();

  let defaultCapacity = 3;
  let timezone = "Asia/Bangkok";
  let slots: PickupSlotRow[] = [];
  if (storeId) {
    const [{ data: storeRow }, { data: slotRows }] = await Promise.all([
      supabase.from("stores").select("default_slot_capacity, timezone").eq("id", storeId).single(),
      supabase
        .from("pickup_slots")
        .select("id, slot_start, slot_end, capacity, booked_count")
        .eq("store_id", storeId)
        .eq("is_open", true)
        .gt("slot_start", new Date().toISOString())
        .order("slot_start", { ascending: true })
        .limit(200),
    ]);
    defaultCapacity = (storeRow?.default_slot_capacity as number | undefined) ?? 3;
    timezone = (storeRow?.timezone as string | undefined) ?? "Asia/Bangkok";
    slots = (slotRows ?? []) as PickupSlotRow[];
  }

  return (
    <>
      <h1>{PAGE_TITLE}</h1>
      <div className="oc-body">
        <CapacitySettingsForm
          storeId={storeId}
          defaultCapacity={defaultCapacity}
          timezone={timezone}
          slots={slots}
        />
      </div>
    </>
  );
}
