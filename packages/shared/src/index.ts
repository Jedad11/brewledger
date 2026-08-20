export * from "./log";
export * from "./alert";
export * from "./money";
export * from "./orderStatus";
export * from "./orderCode";
export * from "./supabase/client";
export * from "./storage/compress";
export * from "./storage/bills";
export * from "./storage/menuImages";
export * from "./storage/usage";
export { browserConfigSchema, loadBrowserConfig } from "./config";
export type { BrowserConfig } from "./config";

// edgeConfigSchema/loadEdgeConfig and workerConfigSchema/loadWorkerConfig are
// deliberately NOT re-exported from this barrel — same reasoning as
// supabase/admin above. They validate SUPABASE_SERVICE_ROLE_KEY, which must
// never be reachable from a browser bundle (apps/shop imports this barrel).
// Reach them via the direct subpath ("@brewledger/shared/dist/config") from
// supabase/functions/* and worker/ only.

// supabase/admin is deliberately NOT re-exported here. It throws at import
// time in a browser bundle, but this barrel is imported by apps/shop — keep
// it reachable only via the direct subpath ("@brewledger/shared/dist/supabase/admin")
// so the eslint RL-3 zone in eslint.config.mjs can target it precisely.

// merchant (MerchantCtx/MerchantStoreSummary) is deliberately NOT re-exported
// here, same reasoning as supabase/admin above. Both types are Owner
// Console-only — this barrel is imported by apps/shop — so keep them
// reachable only via the direct subpath ("@brewledger/shared/dist/merchant")
// so the eslint RL-3 zone in eslint.config.mjs can target it precisely.
// (WBS 4.2 follow-up.)
