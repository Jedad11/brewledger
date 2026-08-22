// @vitest-environment jsdom
//
// WBS 5.8 — iOS-without-standalone detection (isIosNonStandalone) and push
// feature support (isPushSupported). jsdom, not the default node
// environment, because these read navigator.userAgent / window.matchMedia
// directly — same reasoning as StoreProfileForm.test.tsx's own header
// comment on why a jsdom-environment test exists in this app at all.
import { afterEach, describe, expect, it } from "vitest";
import { isIosNonStandalone, isPushSupported } from "./pushSupport";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

function setStandaloneMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === "(display-mode: standalone)" ? matches : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  setStandaloneMedia(false);
  Object.defineProperty(window.navigator, "standalone", { value: undefined, configurable: true });
});

describe("isIosNonStandalone", () => {
  it("REQUIRED: iOS Safari, not installed to home screen -> true", () => {
    setUserAgent(IPHONE_UA);
    setStandaloneMedia(false);
    expect(isIosNonStandalone()).toBe(true);
  });

  it("iOS, installed to home screen (display-mode: standalone) -> false", () => {
    setUserAgent(IPHONE_UA);
    setStandaloneMedia(true);
    expect(isIosNonStandalone()).toBe(false);
  });

  it("iOS, installed to home screen (navigator.standalone, the older iOS signal) -> false", () => {
    setUserAgent(IPHONE_UA);
    setStandaloneMedia(false);
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    expect(isIosNonStandalone()).toBe(false);
  });

  it("Android Chrome -> false regardless of standalone state", () => {
    setUserAgent(ANDROID_CHROME_UA);
    setStandaloneMedia(false);
    expect(isIosNonStandalone()).toBe(false);
  });
});

describe("isPushSupported", () => {
  it("true when both serviceWorker and PushManager exist", () => {
    expect(isPushSupported()).toBe(typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window);
  });
});
