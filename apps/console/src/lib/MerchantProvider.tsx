// WBS 4.2 — exposes the server-resolved MerchantCtx (lib/merchant.ts) to
// client components. The context itself is never fetched client-side: it is
// resolved once, server-side, in (app)/layout.tsx and passed down as a
// prop, so a client component can never observe a pre-resolution or
// stale-session state -- there is no client-side loading/error branch to get
// wrong here, only "the value the server already committed to render."
"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MerchantCtx } from "@brewledger/shared/dist/merchant";

const MerchantContext = createContext<MerchantCtx | null>(null);

export function MerchantProvider({
  merchant,
  children,
}: {
  merchant: MerchantCtx;
  children: ReactNode;
}) {
  return <MerchantContext.Provider value={merchant}>{children}</MerchantContext.Provider>;
}

/**
 * Throws if called outside a MerchantProvider -- every page under
 * (app)/ is guaranteed one by its layout, so a missing provider here means a
 * component was rendered outside that route group, which is itself the bug
 * to surface loudly rather than paper over with an optional return type.
 */
export function useMerchant(): MerchantCtx {
  const ctx = useContext(MerchantContext);
  if (!ctx) {
    throw new Error("useMerchant() called outside a MerchantProvider");
  }
  return ctx;
}
