export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertLocalSupabaseInDev } = await import("@brewledger/shared/dist/config");
  assertLocalSupabaseInDev(process.env.NEXT_PUBLIC_SUPABASE_URL);
}
