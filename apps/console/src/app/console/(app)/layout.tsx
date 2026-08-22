// WBS 4.2 — authenticated route-group layout. A sibling of
// app/console/login/, not a parent of it: proxy.ts already deny-by-defaults
// every /console/:path* route except /console/login before this layout ever
// renders, so login must never sit under a layout that performs a merchant
// lookup pre-auth. This route group adds no URL segment (Next.js route
// groups are a filesystem-only convention) and currently has no page under
// it -- WBS 4.3 is the first real screen; this layout's only job is
// resolving MerchantCtx once per request and handing it to the tree via
// MerchantProvider.
import { redirect } from "next/navigation";
import { resolveMerchantCtx } from "@/lib/merchant";
import { MerchantProvider } from "@/lib/MerchantProvider";
import { NavShell } from "@brewledger/ui";

export default async function AuthenticatedConsoleLayout({ children }: LayoutProps<"/console">) {
  const merchant = await resolveMerchantCtx();

  // proxy.ts already guarantees a valid session reaches this layout. A null
  // result here means the session is valid but no merchants row resolves to
  // it (provisioning race, deleted merchant, RPC failure) -- same
  // deny-by-default posture as proxy.ts's own expired-session path: redirect
  // to login rather than render a partially-authenticated shell.
  if (!merchant) {
    redirect("/console/login");
  }

  // Cross-cutting fix (2026-08): this layout previously rendered zero
  // chrome -- no .oc/.oc-main scaffold, no NavShell -- so every screen
  // under it rendered single-column with no way to navigate except typing
  // a URL. NavShell derives its own active tab from usePathname()
  // internally; `badge` (unseen order count) is left unset here rather than
  // adding new data-fetching plumbing at the layout level -- WBS 5.8's
  // unseen-order mechanism (orders/unseen.ts) is client-side and scoped to
  // InboxClient's own realtime feed, not something this server layout has
  // cheap access to. Flagged as a known follow-up, not silently dropped.
  return (
    <MerchantProvider merchant={merchant}>
      <div className="oc">
        <NavShell surface="console" />
        <main className="oc-main">{children}</main>
      </div>
    </MerchantProvider>
  );
}
