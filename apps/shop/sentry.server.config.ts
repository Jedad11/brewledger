// DORMANT scaffolding (WBS 3.11) — see sentry.client.config.ts's header and
// /docs/ops/observability.md "Sentry: live today vs. deferred" for why this
// is commented out rather than wired.
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
//       const { redact } = require("@brewledger/shared/dist/log");
//       return redact(event, "public");
//     },
//   });
// }

export {};
