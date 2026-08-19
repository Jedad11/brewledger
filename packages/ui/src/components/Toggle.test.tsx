// WBS 4.3 — redline_reviewer post-4.3-audit HIGH finding regression: the
// prototype's own `.oc-sw` control is 56x32, 8px under the 44px tap-min
// interaction_spec.md sets for "everything else" (CLAUDE.md's precedence
// table ranks that spec above the prototype). The fix (Toggle.tsx / .oc-sw
// in components.css, see both files' own header comments) makes `.oc-sw`
// itself the hit target (min-height: var(--tap-min), no visible chrome of
// its own) while `.oc-sw-track`/`.oc-sw-thumb` inside it keep the original
// 56x32 track / 26px thumb visual size unchanged.
//
// This is the FIRST test file in packages/ui (no existing *.test.* files at
// the time this was written, no vitest.config.ts, no jsdom/@testing-library
// dependency). The package's only prior style-verification mechanism is
// scripts/verify-fidelity.mjs, which drives a REAL Chromium via Playwright
// (getComputedStyle against a live page) -- a materially heavier mechanism
// than a single component regression needs, and not wired into `pnpm test`
// at all (it's its own `verify:fidelity` script). Rather than stand up a
// jsdom/playwright rendering environment for one component, this test:
//   1. Renders Toggle via react-dom/server (pure Node, no DOM needed -- see
//      Vite/vitest's default esbuild JSX transform, verified working here
//      with zero extra config) and asserts the DOM STRUCTURE/classes are
//      exactly what components.css's selectors target.
//   2. Parses components.css's own DECLARED rules for .oc-sw / .oc-sw-track
//      / .oc-sw-thumb directly (regex over the real source text, not a
//      hand-copied duplicate) and asserts the declared values.
//   3. Resolves var(--tap-min) against tokens.css's own declared value, so
//      "min-height: var(--tap-min)" is actually checked to mean 44px, not
//      just checked to reference the right variable name by coincidence.
// This is declared-CSS coverage, not a live getComputedStyle browser
// assertion -- flagged here explicitly since the task asked for
// computed/declared min-height and this only proves the latter. If a
// jsdom/playwright rendering harness is added to this package later for
// other reasons, this file's assertions 2-3 should be upgraded to real
// getComputedStyle checks against a live-rendered page.
// packages/ui has no @types/node dependency (its tsconfig.json's `lib` is
// just ["ES2022","DOM"] -- no other file in this package touches a Node
// built-in). The minimal fs/path/url ambient shims this file needs live in
// the sibling node-shims.d.ts (a non-module global script file -- a
// `declare module` written inside a file that itself has imports/exports,
// like this one, is a module AUGMENTATION per the TS spec and requires the
// base module to already be found, which is exactly the "@types/node not a
// dependency" gap being worked around here; a separate ambient .d.ts with no
// top-level import/export is what actually creates a new global module).
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Toggle } from "./Toggle";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_SRC = join(__dirname, ".."); // packages/ui/src

const componentsCss = readFileSync(join(UI_SRC, "components.css"), "utf8");
const tokensCss = readFileSync(join(UI_SRC, "tokens.css"), "utf8");

/**
 * Extracts the declaration body of an EXACT CSS selector (e.g. ".oc-sw",
 * not ".oc-sw-track" or ".oc-sw.is-on ..."). Requires the selector to be
 * immediately followed by `{` in the source, which is how components.css is
 * formatted throughout (no whitespace before the brace) -- this is what
 * keeps ".oc-sw{...}" from accidentally matching inside ".oc-sw-track{...}".
 */
function extractRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found in stylesheet: ${selector}`);
  return match[1];
}

function declaredValue(ruleBody: string, property: string): string {
  const match = ruleBody.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  if (!match) throw new Error(`property "${property}" not declared in rule: ${ruleBody}`);
  return match[1].trim();
}

describe("components.css — .oc-sw tap-target regression (WBS 4.3 HIGH fix)", () => {
  const swRule = extractRule(componentsCss, ".oc-sw");
  const trackRule = extractRule(componentsCss, ".oc-sw-track");
  const thumbRule = extractRule(componentsCss, ".oc-sw-thumb");

  it("tokens.css declares --tap-min as exactly 44px", () => {
    const tapMinMatch = tokensCss.match(/--tap-min:\s*([^;]+);/);
    expect(tapMinMatch).not.toBeNull();
    expect(tapMinMatch![1].trim()).toBe("44px");
  });

  it(".oc-sw (the interactive <button> hit target) declares min-height: var(--tap-min), resolving to 44px", () => {
    expect(declaredValue(swRule, "min-height")).toBe("var(--tap-min)");

    const tapMinMatch = tokensCss.match(/--tap-min:\s*([^;]+);/);
    expect(tapMinMatch![1].trim()).toBe("44px");
  });

  it(".oc-sw carries no visible chrome of its own (no background, no border) -- it's purely the hit target", () => {
    expect(declaredValue(swRule, "border")).toBe("0");
    expect(declaredValue(swRule, "background")).toBe("none");
  });

  it(".oc-sw-track (the VISUAL switch) keeps its original 56x32 size, unchanged by the tap-target fix", () => {
    expect(declaredValue(trackRule, "width")).toBe("56px");
    expect(declaredValue(trackRule, "height")).toBe("32px");
  });

  it(".oc-sw-thumb (the VISUAL knob) keeps its original 26px size, unchanged by the tap-target fix", () => {
    expect(declaredValue(thumbRule, "width")).toBe("26px");
    expect(declaredValue(thumbRule, "height")).toBe("26px");
  });

  it("the track/thumb rules declare no min-height of their own -- 44px lives on .oc-sw alone, not duplicated onto the visual layer", () => {
    expect(/min-height/.test(trackRule)).toBe(false);
    expect(/min-height/.test(thumbRule)).toBe(false);
  });
});

describe("Toggle component — renders the exact structure components.css's selectors target", () => {
  it("the <button> carries class oc-sw (the tap-min hit target), not oc-sw-track or oc-sw-thumb", () => {
    const html = renderToStaticMarkup(
      <Toggle label="เผยแพร่ร้าน" checked={false} onChange={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*class="oc-sw"[^>]*role="switch"/);
  });

  it("the visual track (56x32) and thumb (26px) live INSIDE the button as separate elements, per components.css's nested selectors", () => {
    const html = renderToStaticMarkup(
      <Toggle label="เผยแพร่ร้าน" checked={false} onChange={() => {}} />,
    );
    const buttonMatch = html.match(/<button[^>]*class="oc-sw"[^>]*>(.*?)<\/button>/s);
    expect(buttonMatch).not.toBeNull();
    const buttonInner = buttonMatch![1];
    expect(buttonInner).toMatch(/<span class="oc-sw-track">/);
    expect(buttonInner).toMatch(/<span class="oc-sw-thumb">/);
  });

  it("checked=true adds is-on to the button's class (targets the .oc-sw.is-on .oc-sw-track/.oc-sw-thumb state rules), leaving the track/thumb classes bare", () => {
    const html = renderToStaticMarkup(
      <Toggle label="เผยแพร่ร้าน" checked={true} onChange={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*class="oc-sw is-on"/);
    expect(html).toMatch(/<span class="oc-sw-track">/);
    expect(html).toMatch(/<span class="oc-sw-thumb">/);
  });

  it("aria-checked and role=switch are present regardless of the visual/hit-target split (accessibility unaffected by the fix)", () => {
    const htmlOff = renderToStaticMarkup(
      <Toggle label="x" checked={false} onChange={() => {}} />,
    );
    const htmlOn = renderToStaticMarkup(
      <Toggle label="x" checked={true} onChange={() => {}} />,
    );
    expect(htmlOff).toMatch(/role="switch"/);
    expect(htmlOff).toMatch(/aria-checked="false"/);
    expect(htmlOn).toMatch(/aria-checked="true"/);
  });
});
