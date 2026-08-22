// WBS 5.8 — feature/platform detection. Pure functions (take no DOM
// snapshot themselves beyond the ambient navigator/window) so they're
// trivially unit-testable by stubbing globalThis.navigator per test.

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

// iOS Safari (and every other iOS browser -- they all share WebKit's push
// engine) only allows a Push subscription once the site is added to the
// home screen. Detected here so the inbox can show a hint rather than a
// silently-broken "เปิดการแจ้งเตือน" prompt that can never succeed.
export function isIosNonStandalone(): boolean {
  if (typeof navigator === "undefined") return false;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in globalThis);
  if (!isIOS) return false;
  const standaloneMedia =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(display-mode: standalone)").matches
      : false;
  const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !(standaloneMedia || navigatorStandalone);
}
