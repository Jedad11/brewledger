// WBS 5.8 — sends a Web Push notification for a `push_notify` job. Jobs are
// enqueued by transition_order() itself (packages/db/migrations/
// 0032_order_status_history.sql) on PENDING_PAYMENT->ACCEPTED (kind
// 'merchant_new_order') and on ->PREPARING/->READY (kind
// 'customer_status_update'). Only 'merchant_new_order' is handled here: the
// merchant is the only party with a push_subscriptions row (RLS-scoped,
// written from their own authenticated browser session) — there is no
// customer account to hold a subscription for, and customer-facing status
// changes already propagate via Realtime + poll (WBS 5.9/5.10), not push.
// An unrecognised 'kind' is logged and skipped rather than guessed at.
//
// The polling fallback (apps/console's own 10s visible-tab poll) is what
// makes push non-critical-path: this handler runs on the Render worker
// (cold start 30-60s) precisely because nobody is blocked waiting on it —
// see CLAUDE.md's critical-path rule.
import { createECDH } from "node:crypto";
import webpush from "web-push";
import { pool } from "../db";
import { log } from "../log";
import { loadWorkerConfig } from "@brewledger/shared/dist/config";
import { formatSatangAsThb } from "@brewledger/shared/dist/money";
import type { Job, JobHandler } from "./types";

interface OrderRow {
  order_code: string;
  total_satang: number;
  slot_start: string | null;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

function formatPickupTime(slotStart: string | null): string | null {
  if (!slotStart) return null;
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(slotStart));
}

// Thai copy per docs/design/state_matrix.md's "ออเดอร์ /console/orders"
// section (WBS 5.8 addition) — reuses the same "มีออเดอร์ใหม่" root phrase
// as the in-app banner and the same "รับ HH:MM น." idiom OrderCard already
// renders, rather than inventing a third phrasing for the same fact.
function buildNotificationPayload(order: OrderRow): { title: string; body: string; url: string } {
  const pickupTime = formatPickupTime(order.slot_start);
  const body = pickupTime
    ? `${order.order_code} · รับ ${pickupTime} น. · ${formatSatangAsThb(order.total_satang)}`
    : `${order.order_code} · ${formatSatangAsThb(order.total_satang)}`;
  return { title: "มีออเดอร์ใหม่", body, url: "/console/orders" };
}

// The WBS 5.8 manual-action step (dictionary §5.8) has the operator store
// ONLY the private key as a secret on the worker (and on Supabase Edge
// Function secrets) — the public key goes exclusively to Vercel's
// NEXT_PUBLIC_VAPID_PUBLIC_KEY, which this Node process has no access to and
// must not need, since duplicating a second copy of the key pair onto a
// third deployment target is exactly the kind of drift-prone manual step
// CLAUDE.md's "no second scheduling mechanism invented" posture argues
// against elsewhere in this codebase. A VAPID key pair is a single P-256
// (prime256v1) EC key; web-push's own generateVAPIDKeys() produces the
// public point as an uncompressed EC point purely as a function of the
// private scalar, so it is re-derivable with Node's built-in ECDH rather
// than requiring a second secret that could ever drift out of sync with the
// first.
function derivePublicKeyFromPrivateKey(privateKeyB64Url: string): string {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privateKeyB64Url, "base64url"));
  return ecdh.getPublicKey().toString("base64url");
}

// VAPID_PRIVATE_KEY is optional on workerConfigSchema (packages/shared/src/
// config.ts) precisely so a missing secret can't take down the whole
// process at startup — db.ts loads that schema synchronously at module
// load, before generateSlots/expireOrders/anything else in the queue ever
// runs. This function is where "is push actually configured" is enforced
// instead: lazily, the first time a push_notify job needs to send, so a
// missing key fails only THIS job (queue.ts retries it, then eventually
// dead-letters and alerts) — never the poller, never expireOrders, never
// any other handler.
let vapidConfigured = false;
function ensureVapidConfigured(): void {
  if (vapidConfigured) return;
  const config = loadWorkerConfig();
  if (!config.VAPID_PRIVATE_KEY) {
    throw new Error(
      "VAPID_PRIVATE_KEY is not set. See docs/security/secrets.md (WBS 5.8) — " +
        "push_notify jobs cannot send until it's configured on the worker; " +
        "the polling fallback covers merchants in the meantime.",
    );
  }
  webpush.setVapidDetails(
    "mailto:support@brewledger.app",
    derivePublicKeyFromPrivateKey(config.VAPID_PRIVATE_KEY),
    config.VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
}

async function deleteSubscription(id: string): Promise<void> {
  await pool.query(`delete from push_subscriptions where id = $1`, [id]);
}

export const pushNotify: JobHandler = async (job: Job) => {
  const kind = job.payload.kind;
  if (kind !== "merchant_new_order") {
    log.info("push_notify: no-op for kind", { job_id: job.id, kind });
    return;
  }

  const orderId = job.payload.orderId as string | undefined;
  if (!orderId || !job.store_id) {
    log.error("push_notify: missing orderId or store_id on payload", { job_id: job.id });
    return;
  }

  const { rows: orderRows } = await pool.query<OrderRow>(
    `select o.order_code, o.total_satang, ps.slot_start
       from orders o
       left join pickup_slots ps on ps.id = o.pickup_slot_id
      where o.id = $1`,
    [orderId],
  );
  const order = orderRows[0];
  if (!order) {
    log.error("push_notify: order not found", { job_id: job.id, order_id: orderId });
    return;
  }

  const { rows: subscriptions } = await pool.query<SubscriptionRow>(
    `select id, endpoint, p256dh, auth_key from push_subscriptions where store_id = $1`,
    [job.store_id],
  );
  if (subscriptions.length === 0) {
    // Normal before the merchant has ever granted permission on any device
    // — the polling fallback is what covers this merchant until they do.
    log.info("push_notify: no subscriptions for store", { job_id: job.id, store_id: job.store_id });
    return;
  }

  ensureVapidConfigured();
  const payload = JSON.stringify(buildNotificationPayload(order));

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        },
        payload,
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Gone: the browser revoked or expired this subscription. Deleting
        // it is what lets a future subscribe flow re-create a fresh row
        // instead of failing on the old endpoint's unique constraint.
        await deleteSubscription(sub.id);
        log.info("push_notify: removed dead subscription", { job_id: job.id, subscription_id: sub.id, statusCode });
        continue;
      }
      // Any other failure (network blip, transient 5xx from the push
      // service) is logged and skipped, not rethrown — rethrowing here
      // would let queue.ts retry the WHOLE job, re-sending to every
      // subscription that already succeeded above.
      log.error("push_notify: send failed", {
        job_id: job.id,
        subscription_id: sub.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
