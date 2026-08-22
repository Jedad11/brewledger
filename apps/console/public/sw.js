// WBS 5.8 — Owner Console service worker. Handles exactly two events:
// 'push' (render the notification worker/src/handlers/pushNotify.ts sent)
// and 'notificationclick' (focus the existing /console/orders tab, or open
// one). Registered from apps/console's own subscribe flow
// (src/app/console/(app)/orders/pushSubscribe.ts), never auto-registered by
// Next.js — this is a plain static file served at the origin root
// (public/sw.js -> /sw.js), which is required for its default scope to
// cover the whole app rather than just /console/orders/.
//
// No 'install'/'activate' caching logic on purpose: this worker exists
// solely to receive push while the tab may be closed. The polling fallback
// (useOrdersFeed.ts) is what keeps the inbox itself correct — this file has
// no offline/asset-caching responsibility to get wrong.
self.addEventListener("push", (event) => {
  let data = { title: "มีออเดอร์ใหม่", body: "", url: "/console/orders" };
  if (event.data) {
    try {
      data = Object.assign(data, event.data.json());
    } catch {
      data.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.ico",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/console/orders";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.indexOf("/console/orders") !== -1 && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
