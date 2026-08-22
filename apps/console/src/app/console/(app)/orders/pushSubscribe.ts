// WBS 5.8 — service worker registration + the actual subscribe call.
// Deliberately split from WHEN to call requestPushSubscription()
// (InboxClient.tsx decides that: after the merchant's first paid order, not
// on page load) so this file is pure browser-API plumbing, easy to reason
// about and to stub in a test.
import { savePushSubscription } from "./actions";
import { isPushSupported } from "./pushSupport";

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

// VAPID applicationServerKey must be a Uint8Array, but pushManager.subscribe
// takes the urlsafe-base64 public key as a string — this is the standard
// conversion (RFC 4648 §5 urlsafe alphabet -> raw bytes).
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type SubscribeOutcome = "subscribed" | "denied" | "unsupported" | "failed";

// Idempotent: if a subscription already exists for this browser (e.g. a
// prior successful subscribe, or permission was already granted), it is
// reused and re-saved rather than re-requesting permission — this is also
// what covers "a revoked or expired subscription is re-requested" (WBS 5.8
// acceptance): calling this again once permission is already 'granted'
// creates a fresh subscription object without a new prompt.
export async function requestPushSubscription(): Promise<SubscribeOutcome> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey || !isPushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!registration) return "failed";
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Uint8Array.from()'s inferred generic (ArrayBufferLike, which
      // includes SharedArrayBuffer) is narrower than what it actually
      // returns at runtime (always a plain ArrayBuffer-backed view) — the
      // DOM lib's PushSubscriptionOptionsInit wants BufferSource<ArrayBuffer>.
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "failed";

  const result = await savePushSubscription({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    authKey: json.keys.auth,
    userAgent: navigator.userAgent,
  });
  return result.ok ? "subscribed" : "failed";
}
