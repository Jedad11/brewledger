// DORMANT scaffolding (WBS 3.11) — see /docs/ops/observability.md
// "Sentry: live today vs. deferred".
//
// @sentry/nextjs is deliberately NOT a dependency of this app yet: there is
// no Sentry DSN (the WBS 3.11 manual account-creation step has not been
// done), and apps/console has no real screen beyond the coming-soon page —
// Phase 4/5 (auth, menu, checkout) have not started. Wiring a live SDK
// against nothing but a placeholder page would be unverifiable.
//
// When Phase 4/5 land a real screen and a NEXT_PUBLIC_SENTRY_DSN exists:
//   1. pnpm add @sentry/nextjs --filter @brewledger/console
//   2. uncomment the block below
//   3. wrap next.config.ts's export with withSentryConfig (see
//      @sentry/nextjs's current setup docs for the wrapper shape — it
//      changes across major versions, check before copying blindly)
//   4. re-run `npx @sentry/wizard@latest -i nextjs` if the SDK's expected
//      file layout has moved since this comment was written
//
// import * as Sentry from "@sentry/nextjs";
//
// const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
// if (dsn) {
//   Sentry.init({
//     dsn,
//     release: process.env.VERCEL_GIT_COMMIT_SHA,
//     tracesSampleRate: 0.1,
//     beforeSend(event) {
//       // Same redaction rule as every runtime — see packages/shared/src/log.ts.
//       // runtime "console": cost/margin fields are NOT stripped here (the
//       // Owner Console is the one surface allowed to see them) — only the
//       // secret-key rule applies. Do not pass "public" here; that would be
//       // wrong for this app and would silently hide real costing bugs.
//       const { redact } = require("@brewledger/shared/dist/log");
//       return redact(event, "console");
//     },
//   });
// }

export {};
