import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { fetchOrderDetail } from "../fetchOrderDetail";
import { OrderDetailClient } from "./OrderDetailClient";

// WBS 5.9 — /console/orders/{id}. Same shell/guard pattern as
// /console/menu/{id} (WBS 4.4): resolve merchant + current store, 404 a
// row that doesn't resolve rather than rendering a broken page under an
// existing-looking id. RLS (merchant_rw_orders, 0021_rls.sql) already
// scopes the underlying query to the caller's own stores; the explicit
// storeId filter inside fetchOrderDetail is the WBS 4.2 second layer, same
// as every other console page in this app.
export default async function OrderDetailPage({ params }: PageProps<"/console/orders/[id]">) {
  const { id } = await params;

  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  const storeId = currentStoreId(merchant);
  if (!storeId) {
    redirect("/console/settings/store");
  }

  const supabase = await createClient();
  const order = await fetchOrderDetail(supabase, storeId, id);
  if (!order) {
    notFound();
  }

  return <OrderDetailClient order={order} />;
}
