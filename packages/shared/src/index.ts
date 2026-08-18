export * from "./money";
export * from "./orderStatus";
export * from "./orderCode";
export * from "./supabase/client";
export * from "./storage/compress";
export * from "./storage/bills";
export * from "./storage/usage";

// supabase/admin is deliberately NOT re-exported here. It throws at import
// time in a browser bundle, but this barrel is imported by apps/shop — keep
// it reachable only via the direct subpath ("@brewledger/shared/dist/supabase/admin")
// so the eslint RL-3 zone in eslint.config.mjs can target it precisely.
