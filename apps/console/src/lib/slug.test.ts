// WBS 4.3 — Testing block coverage for apps/console/src/lib/slug.ts.
//
// Pure-function unit tests, no network/DB, matching the style of
// phone.test.ts (WBS 4.1) -- these are pure string transforms with zero I/O.
//
// Covers the Testing block items explicitly called out for this file:
//   - Thai-to-Latin transliteration produces stable ASCII output.
//   - slugify() only ever emits [a-z0-9-] (no other characters survive).
//   - never produces a blank string (fallback to `cafe-` + random suffix).
// The fourth item (collision-retry-on-23505 sequencing) lives in
// actions.test.ts, since it's actions.ts's own retry loop, not this file's.
import { describe, expect, it } from "vitest";
import {
  generateSlugBase,
  slugify,
  transliterateThaiToLatin,
  withCollisionSuffix,
} from "./slug";

describe("transliterateThaiToLatin", () => {
  it("produces a stable ASCII-only output for a real Thai cafe name", () => {
    const input = "กาแฟ";
    const out = transliterateThaiToLatin(input);
    expect(/^[\x00-\x7F]*$/.test(out)).toBe(true);
  });

  it("is deterministic -- the same input always produces the same output", () => {
    const input = "ร้านกาแฟบ้านสวน";
    const first = transliterateThaiToLatin(input);
    const second = transliterateThaiToLatin(input);
    expect(first).toBe(second);
  });

  it("passes non-Thai characters (Latin, digits, spaces, punctuation) through unchanged", () => {
    expect(transliterateThaiToLatin("Coffee 24/7")).toBe("Coffee 24/7");
  });

  it("every character mapped stays within plain ASCII, character by character", () => {
    // Every Thai character brew_ledger's own THAI_TO_LATIN table maps to
    // either an empty string (tone marks/silencers/vowel carrier) or a run
    // of plain Latin letters/digits -- so translating any mixed string and
    // then filtering out the untranslated (already-ASCII) characters should
    // still leave only ASCII behind.
    const input = "เชียงใหม่ Bangkok 2026";
    const out = transliterateThaiToLatin(input);
    for (const ch of out) {
      expect(ch.charCodeAt(0)).toBeLessThan(128);
    }
  });

  it("documents the known non-syllable-reordering limitation: เชียงใหม่ transliterates letter-by-letter, not as real RTGS", () => {
    // slug.ts's own header comment: a flat per-character map, not
    // syllable-aware reordering, so a leading vowel (เ) stays in reading
    // order rather than moving after the consonant it modifies. This test
    // pins that documented, accepted behavior so it can't silently change.
    expect(transliterateThaiToLatin("เชียงใหม่")).toBe("echiyngaihm");
  });
});

describe("slugify", () => {
  it("only ever emits [a-z0-9-] -- no other character survives, across a mixed adversarial input", () => {
    const input = "Café ☕ 100%_Arabica!! ยินดี ต้อนรับ #1 (สาขา2)";
    const out = slugify(transliterateThaiToLatin(input));
    expect(/^[a-z0-9-]*$/.test(out)).toBe(true);
  });

  it("lowercases mixed-case Latin input", () => {
    expect(slugify("Brew LEDGER Cafe")).toBe("brew-ledger-cafe");
  });

  it("collapses runs of non-alphanumeric characters into a single hyphen", () => {
    expect(slugify("a---b   c___d")).toBe("a-b-c-d");
  });

  it("trims leading and trailing hyphens produced by leading/trailing punctuation", () => {
    expect(slugify("  !!Hello World!!  ")).toBe("hello-world");
  });

  it("an all-symbol input slugifies to an empty string (never leaks a stray character)", () => {
    expect(slugify("!!!___###")).toBe("");
  });
});

describe("generateSlugBase", () => {
  it("never produces a blank string -- an emoji-only name falls back to cafe- plus a random suffix", () => {
    const base = generateSlugBase("☕☕☕");
    expect(base.length).toBeGreaterThan(0);
    expect(base.startsWith("cafe-")).toBe(true);
    expect(/^[a-z0-9-]+$/.test(base)).toBe(true);
  });

  it("never produces a blank string for an all-symbol name either", () => {
    const base = generateSlugBase("!!!###");
    expect(base.length).toBeGreaterThan(0);
    expect(base.startsWith("cafe-")).toBe(true);
  });

  it("the cafe- fallback suffix differs across calls (so two blank-name stores don't collide by default)", () => {
    const a = generateSlugBase("☕");
    const b = generateSlugBase("☕");
    // Not a hard guarantee (random suffix has a small collision chance),
    // but with a 4-char base36 suffix the odds of an accidental match in a
    // 2-sample test are negligible enough that a failure here would be
    // worth investigating rather than dismissing as flaky.
    expect(a).not.toBe(b);
  });

  it("a real Thai cafe name produces a real (non-fallback) ASCII slug", () => {
    const base = generateSlugBase("ร้านกาแฟ");
    expect(base.length).toBeGreaterThan(0);
    expect(base.startsWith("cafe-")).toBe(false);
    expect(/^[a-z0-9-]+$/.test(base)).toBe(true);
  });

  it("an already-Latin name round-trips to a clean slug, not the fallback", () => {
    expect(generateSlugBase("Brew Ledger")).toBe("brew-ledger");
  });
});

describe("withCollisionSuffix", () => {
  it("attempt 1 returns the base unchanged", () => {
    expect(withCollisionSuffix("my-cafe", 1)).toBe("my-cafe");
  });

  it("attempt 2 appends -2, attempt 3 appends -3, and so on", () => {
    expect(withCollisionSuffix("my-cafe", 2)).toBe("my-cafe-2");
    expect(withCollisionSuffix("my-cafe", 3)).toBe("my-cafe-3");
    expect(withCollisionSuffix("my-cafe", 20)).toBe("my-cafe-20");
  });
});
