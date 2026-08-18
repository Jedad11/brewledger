// Typed, validated configuration loaders (WBS 3.9).
//
// Three separate schemas, one per runtime, so each caller only validates the
// variables it can legitimately hold:
//   - browserConfigSchema : apps/shop and apps/console client code
//   - edgeConfigSchema    : supabase/functions/* (Supabase Edge Functions, Deno)
//   - workerConfigSchema  : worker/ (Render, Node)
//
// Every loader throws SYNCHRONOUSLY, at call time, naming the exact missing
// variable and the WBS entry that documents where it comes from. It never
// falls back to a default for a secret, and it never logs a value — only
// names ever appear in an error message or a log line.
//
// No gateway-mode ("sandbox"/"live") assertion exists here on purpose: this
// architecture has no payment gateway. Money moves directly from the
// customer's bank to the merchant's own PromptPay account (RL-1), so there
// is no gateway credential and no sandbox/live split to assert against. The
// equivalent hazard — a wrong PromptPay alias sending a customer's money to
// a stranger — is guarded at data-entry and payload-build time instead, not
// at process startup: see the merchant self-verification step (WBS 4.5) and
// the decoded-payload assertions on QR generation (WBS 5.5).
import { z } from "zod";

const missingVarMessage = (name: string, docRef: string) =>
  `Missing required environment variable ${name}. See ${docRef}. ` +
  `Never falls back to a default for a secret — set it in the environment ` +
  `and retry.`;

function loadConfig<Schema extends z.ZodTypeAny>(
  schema: Schema,
  keys: readonly (keyof z.infer<Schema> & string)[],
  docRef: string,
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): z.infer<Schema> {
  const values: Record<string, string | undefined> = {};
  for (const key of keys) {
    values[key] = source[key];
  }

  const result = schema.safeParse(values);
  if (!result.success) {
    const firstMissing = result.error.issues[0];
    const name = String(firstMissing.path[0] ?? keys[0]);
    throw new Error(missingVarMessage(name, docRef));
  }
  return result.data;
}

const nonEmpty = (name: string) =>
  z.string({ required_error: `Missing required environment variable ${name}` }).min(1, {
    message: `Missing required environment variable ${name}`,
  });

// --- browser (apps/shop, apps/console client bundles) ----------------------
// These two are NEXT_PUBLIC_* by design — they ship in the browser bundle.
// The anon key is not a secret (docs/security/keys.md); RLS is the actual
// enforcement boundary for what it can read.
export const browserConfigSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: nonEmpty("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
});
export type BrowserConfig = z.infer<typeof browserConfigSchema>;

const BROWSER_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export function loadBrowserConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): BrowserConfig {
  return loadConfig(browserConfigSchema, BROWSER_KEYS, "docs/security/secrets.md (WBS 3.9)", source);
}

// --- edge (supabase/functions/*, Deno) --------------------------------------
// SUPABASE_SERVICE_ROLE_KEY bypasses RLS entirely (RL-3) — Edge Functions are
// one of exactly two legitimate holders (the other is the Render worker).
// VAPID_PRIVATE_KEY is documented at WBS 5.8 (Web Push).
export const edgeConfigSchema = z.object({
  SUPABASE_URL: nonEmpty("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty("SUPABASE_SERVICE_ROLE_KEY"),
  VAPID_PRIVATE_KEY: nonEmpty("VAPID_PRIVATE_KEY"),
});
export type EdgeConfig = z.infer<typeof edgeConfigSchema>;

const EDGE_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VAPID_PRIVATE_KEY"] as const;

export function loadEdgeConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): EdgeConfig {
  return loadConfig(edgeConfigSchema, EDGE_KEYS, "docs/security/secrets.md (WBS 3.9, VAPID_PRIVATE_KEY see WBS 5.8)", source);
}

// --- worker (worker/, Node on Render) ---------------------------------------
// The edge set plus DATABASE_URL (direct Postgres, for FOR UPDATE SKIP
// LOCKED job claims that PostgREST cannot express — see worker/src/db.ts)
// and FLOAT16_API_KEY (Typhoon OCR, documented at WBS 6.2).
export const workerConfigSchema = edgeConfigSchema.extend({
  DATABASE_URL: nonEmpty("DATABASE_URL"),
  FLOAT16_API_KEY: nonEmpty("FLOAT16_API_KEY"),
});
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

const WORKER_KEYS = [...EDGE_KEYS, "DATABASE_URL", "FLOAT16_API_KEY"] as const;

export function loadWorkerConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): WorkerConfig {
  return loadConfig(
    workerConfigSchema,
    WORKER_KEYS,
    "docs/security/secrets.md (WBS 3.9, FLOAT16_API_KEY see WBS 6.2, VAPID_PRIVATE_KEY see WBS 5.8)",
    source,
  );
}
