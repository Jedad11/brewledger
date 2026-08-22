# WBS 5.8 — Push / Poll Device Matrix

Template only — every row below is empty until a human runs the real-device
steps in `BrewLedger_WBS_Dictionary.md` §5.8 ("ทดสอบบนมือถือจริงทั้งสองระบบ").
This cannot be filled in by an agent: it requires two physical handsets (an
Android + Chrome device and an iPhone + Safari device), a real order placed
by a second person while the console tab is backgrounded or closed, and a
stopwatch. See the WBS entry's own manual-action block for the exact script
(grant, close tab, order, expect a push within 10s; then deny/skip
home-screen-install, keep the tab open, expect the same order within 10s via
polling).

Add one row per device/browser/mode combination actually tested. Do not mark
a row done from a desktop-browser DevTools push simulation — this table
exists because DevTools simulation is exactly what does NOT catch the real
gap (iOS Safari's push-only-after-home-screen-install restriction, real
carrier network latency, OS-level notification throttling).

| Device | OS version | Browser | Standalone (added to home screen)? | Permission | Push latency | Poll latency |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |

**Columns**

- **Permission** — one of: granted / denied / not supported.
- **Push latency** — seconds from the test order's payment confirmation to
  the OS notification appearing, tab closed. Record "—" (not "0") if push
  was never delivered within a reasonable wait (e.g. > 60s) and note why in
  a trailing comment.
- **Poll latency** — seconds from payment confirmation to the order
  appearing in the open `/console/orders` tab (should be ≤ 10s per the
  acceptance criterion; the 10s visible-tab poll is the fallback this number
  is actually verifying, independent of the Permission column).
