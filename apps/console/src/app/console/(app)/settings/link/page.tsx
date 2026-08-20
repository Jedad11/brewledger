import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { StoreLinkQR } from "./StoreLinkQR";
import { PAGE_TITLE } from "./copy";
import type { Database } from "@brewledger/db/types";

type StoreRow = Pick<Database["public"]["Tables"]["stores"]["Row"], "name" | "slug" | "is_published">;

export default async function StoreLinkPage() {
  const merchant = await resolveMerchantCtx();
  // (app)/layout.tsx already redirects a null merchant to /console/login;
  // this defensive check keeps this page safe if it's ever reached another
  // way, matching the store/payments settings pages' own posture.
  if (!merchant) {
    redirect("/console/login");
  }

  const supabase = await createClient();

  const { data: storeRow } = await supabase
    .from("stores")
    .select("name, slug, is_published")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const store = storeRow as StoreRow | null;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl font-bold leading-[1.35] text-ink">{PAGE_TITLE}</h1>
      <StoreLinkQR
        store={store ? { name: store.name, slug: store.slug, isPublished: store.is_published } : null}
      />
    </main>
  );
}
