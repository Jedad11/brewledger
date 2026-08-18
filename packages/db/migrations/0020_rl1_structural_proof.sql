-- ============================================================================
-- RL-1 STRUCTURAL PROOF
-- ============================================================================
-- This schema contains no table representing a platform balance, escrow,
-- float, wallet, ledger_account, or payout. This absence is deliberate, not
-- an oversight: BrewLedger money moves directly from the customer's bank to
-- the merchant's own PromptPay account (see stores.promptpay_id/_type and
-- payments.payee_alias). BrewLedger never holds, nets, or settles money on a
-- merchant's behalf, so no table here should ever be added to represent one.
--
-- Asserted by an introspection test (WBS 3.5 acceptance criteria) that fails
-- the build if any table name matches /balance|escrow|float|wallet|payout|
-- ledger_account/. stock_ledger is stock-quantity, not money — the "ledger"
-- in its name refers to an append-only movement log, matching the same
-- append-only pattern used for accounting ledgers, but it carries no
-- currency amount and is not a match for that regex.
-- ============================================================================

comment on schema public is
  'BrewLedger public schema. RL-1 structural proof: no balance, escrow, float,
   wallet, ledger_account, or payout table exists here by design. See
   packages/db/migrations/0020_rl1_structural_proof.sql for the full note.';
