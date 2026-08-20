# ADR-008: Direct merchant-owned PromptPay, no payment gateway

> **Note on numbering.** This is the first ADR committed to the repo.
> `CLAUDE.md` and code comments elsewhere (`packages/shared/src/alert.ts`,
> `packages/shared/src/config.ts`, `packages/shared/src/merchant.ts`) already
> refer to "ADR-008" and to a superseded licensed-gateway decision as if both
> existed before this file was written. No `docs/adr/001-infrastructure-choice.md`
> and no `docs/adr/007-licensed-gateway.md` exist in this repo to supersede —
> this ADR is written standing alone, establishing the direct-PromptPay
> decision directly rather than superseding a prior record that was never
> committed. The number is kept at 008 to match every existing reference
> rather than renumbering it to 001, which would break those references.

## Status

Accepted.

## Context

BrewLedger's original payment plan (the WBS's Phase 4/5 payment entries, in
their earlier form) integrated each pilot store with a licensed payment
gateway (2C2P or Omise) and shepherded that store through the gateway's KYC
process. Two problems surfaced during pilot-store screening:

1. **KYC eligibility.** 2C2P requires a commercial registration at least one
   year old. Most of the target pilot stores are sole-proprietor Thai
   independent coffee shops with no such registration — the gateway's own
   onboarding excludes them outright.
2. **Timeline.** Gateway KYC, where a store is eligible at all, takes
   15–20 business days. That does not fit the delivery window.

## Decision

Remove the payment gateway from the MVP entirely. A merchant enters their
own PromptPay identifier — a mobile number, national ID, or tax ID — and
Brew Ledger builds a payable EMVCo QR code locally from that identifier and
an order total. Money moves bank-to-bank, directly from the customer to the
merchant's own PromptPay-linked account. Brew Ledger is not a party to the
transfer in any capacity: no gateway account, no settlement instruction, no
intermediary, no platform balance, escrow, float, or ledger account (RL-1).

Consequences of this shape, by design:

- `stores.promptpay_id` / `stores.promptpay_type` / `stores.promptpay_verified_at`
  are the only payment-identity columns on `stores`. No bank account number,
  account name, branch, SWIFT, or IBAN is ever stored — the PromptPay
  identifier is a routing alias published in the national directory, not an
  account number.
- QR generation (`packages/shared/src/promptpay/generate.ts`, WBS 4.5/5.5)
  is a pure function: no network call, no credentials, no external
  dependency at runtime. It cannot fail because a third party is down, and
  it survives a merchant with no commercial registration.
- There is no gateway webhook, so **payment confirmation becomes a merchant
  action rather than an automatic event** (WBS 5.6). This is a real
  trade-off, accepted deliberately: the alternative was excluding most of
  the pilot cohort or missing the delivery window.
- The merchant's own verification step — scanning the preview QR with their
  own banking app and confirming they see their own name as payee — is the
  functional replacement for gateway KYC as the safeguard against a
  misconfigured payee. It is the merchant's own eyes, not a claim in a
  document.
- `packages/shared/src/config.ts` asserts no gateway-mode ("sandbox"/"live")
  environment variable on purpose — there is no gateway credential to
  configure.

## Consequences / follow-ups

- WBS 5.5/5.6 (order-level QR issuance and payment confirmation) build on
  the payload generator this ADR's implementation (WBS 4.5) introduced.
- `packages/db/prisma/schema.prisma` and `packages/db/seed.ts` still contain
  gateway-shaped fields (`gatewayProvider`, `gatewayMerchantId`,
  `gatewayKycStatus`, `absorbGatewayFee`, `Payment.provider`,
  `settledToMerchantAccount`) left over from the withdrawn plan. These are
  Prisma-era artifacts unrelated to the live SQL migrations in
  `packages/db/migrations/`, which were designed direct-PromptPay from the
  start and never had gateway columns. Cleaning up the stale Prisma schema
  is WBS 3.5's scope, not this entry's.
