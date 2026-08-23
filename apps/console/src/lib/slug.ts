// WBS 4.3 — Thai store name -> public URL slug (`brewledger.app/s/{slug}`).
//
// Kept local to apps/console, like phone.ts: only the console ever generates
// a slug (apps/shop only reads one via the route param), so there's no
// cross-app reuse to justify packages/shared.
//
// Transliteration is a flat per-character lookup, not syllable-aware
// reordering -- a leading vowel (เ/แ/โ/ใ/ไ) sits before the consonant it's
// pronounced after in real Thai, so e.g. "เชียงใหม่" becomes "echiyngaihm",
// not "chiang-mai". The WBS entry's own words: "correctness matters less
// than producing a stable readable ASCII slug." A full RTGS engine needs
// syllable segmentation; a flat map is enough to clear that bar, is trivial
// to audit, and is deterministic per character.
// Every key is a quoted string literal, not a bare identifier: several Thai
// vowel/tone marks are Unicode combining characters (category Mn), which
// are valid inside a JS identifier but not as its first character -- a bare
// `ั: "a"` is a syntax error. Quoting everything sidesteps needing to know
// which characters are affected.
const THAI_TO_LATIN: Record<string, string> = {
  // consonants (initial-sound approximation)
  "ก": "k", "ข": "kh", "ฃ": "kh", "ค": "kh", "ฅ": "kh", "ฆ": "kh",
  "ง": "ng",
  "จ": "ch", "ฉ": "ch", "ช": "ch", "ฌ": "ch",
  "ซ": "s", "ศ": "s", "ษ": "s", "ส": "s",
  "ญ": "y", "ย": "y",
  "ฎ": "d", "ด": "d",
  "ฏ": "t", "ต": "t",
  "ฐ": "th", "ฑ": "th", "ฒ": "th", "ถ": "th", "ท": "th", "ธ": "th",
  "ณ": "n", "น": "n",
  "บ": "b",
  "ป": "p",
  "ผ": "ph", "พ": "ph", "ภ": "ph",
  "ฝ": "f", "ฟ": "f",
  "ม": "m",
  "ร": "r",
  "ล": "l", "ฬ": "l",
  "ว": "w",
  "ห": "h", "ฮ": "h",
  "อ": "", // vowel carrier -- silent on its own
  // vowels / vowel marks
  "ะ": "a", "ั": "a", "า": "a", "ๅ": "a",
  "ำ": "am",
  "ิ": "i", "ี": "i",
  "ึ": "ue", "ื": "ue",
  "ุ": "u", "ู": "u",
  "เ": "e", "แ": "ae", "โ": "o", "ใ": "ai", "ไ": "ai",
  "็": "", // short-vowel mark -- sound already carried by the vowel it sits under
  // tone marks / silencer -- carry no sound of their own
  "่": "", "้": "", "๊": "", "๋": "", "์": "", "ๆ": "", "ฯ": "",
  // Thai digits
  "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4",
  "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9",
};

export function transliterateThaiToLatin(input: string): string {
  let out = "";
  for (const ch of input) {
    out += ch in THAI_TO_LATIN ? THAI_TO_LATIN[ch] : ch;
  }
  return out;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

// Auto-suggested slug from a store name, before any collision handling.
// Never blank -- WBS 4.3: "it may never be blank." A name that transliterates
// to nothing usable (emoji-only, symbols, already-Latin-but-stripped-empty)
// falls back to 'cafe' plus a short random suffix, per the WBS's own prompt.
export function generateSlugBase(name: string): string {
  const slug = slugify(transliterateThaiToLatin(name));
  return slug.length > 0 ? slug : `cafe-${randomSuffix()}`;
}

// -2, -3, ... collision suffix. Kept separate from generateSlugBase so a
// caller can retry with an incrementing attempt count against a real
// uniqueness violation from Postgres, rather than a live pre-check query --
// see actions.ts's header comment for why a pre-check can't be trusted here
// (an RLS-scoped merchant client can't see another merchant's unpublished
// store slug to check it in advance).
export function withCollisionSuffix(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}

// WBS 4.6 — single source for the public store URL, reused by the store
// profile screen's slug preview note (StoreProfileForm.tsx) and by
// settings/link's QR/print sheet, so the two never drift apart.
//
// TEMPORARY (2026-08-23): the state matrix's own store-profile copy hardcodes
// "brewledger.app/s/{slug}", but that domain was never purchased or pointed
// at the apps/shop Vercel project -- every generated link/QR 404'd for real
// merchants. Pointed at the actual live production host
// (brewledger-shop.vercel.app) instead so links work tonight. Swap back to
// "brewledger.app" once that domain is bought and added under apps/shop's
// Vercel project Settings -> Domains (see PROGRESS.md for the follow-up).
export const PUBLIC_STORE_HOST = "brewledger-shop.vercel.app";

// RL-3: the QR/link payload is exactly this URL and nothing else -- no
// merchant id, store id, or token. Anything more is a potential enumeration
// vector, and this exact string is what gets printed and photographed by
// strangers.
export function buildPublicStoreUrl(slug: string): string {
  return `https://${PUBLIC_STORE_HOST}/s/${slug}`;
}
