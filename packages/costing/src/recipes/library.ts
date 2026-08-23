// WBS 6.7 -- Suggested BOM and Optional Recipe Editor: the seed library.
//
// THESE ARE STARTING POINTS TO EDIT, NOT STANDARDS TO COMPLY WITH. Every
// shop's actual recipe differs -- different bean, different milk brand,
// different pour -- and that is normal, not a gap. This library exists only
// to save a merchant the trouble of typing "18 g coffee, 200 ml milk" from a
// blank form; nothing here is ever enforced, validated against, or used to
// flag a shop's own numbers as wrong. See RL-2 (CLAUDE.md) and RecipeBlock's
// own header comment (packages/ui/src/components/RecipeBlock.tsx) for the
// same principle applied to the editor UI this feeds.
import type { BaseUnit } from "../units";

export interface RecipeLibraryLine {
  ingredientName: string;
  qtyBaseUnit: number;
  baseUnit: BaseUnit;
}

export interface RecipeLibraryEntry {
  name: string;
  aliases: string[];
  lines: RecipeLibraryLine[];
}

export const RECIPE_LIBRARY: RecipeLibraryEntry[] = [
  {
    name: "เอสเพรสโซ่",
    aliases: ["เอสเพรสโซ", "เอสเปรสโซ่", "เอสเปรสโซ", "espresso"],
    lines: [{ ingredientName: "เมล็ดกาแฟคั่ว", qtyBaseUnit: 18, baseUnit: "g" }],
  },
  {
    name: "อเมริกาโน่",
    aliases: ["อเมริกาโน", "อเมริกาโน่ร้อน", "อเมริกาโน่เย็น", "อเมริกาโน่ปั่น", "americano"],
    lines: [
      { ingredientName: "เมล็ดกาแฟคั่ว", qtyBaseUnit: 18, baseUnit: "g" },
      { ingredientName: "น้ำ", qtyBaseUnit: 150, baseUnit: "ml" },
    ],
  },
  {
    name: "ลาเต้",
    aliases: ["ลาเต", "ลาเต้ร้อน", "ลาเต้เย็น", "ลาเต้ปั่น", "late", "latte"],
    lines: [
      { ingredientName: "เมล็ดกาแฟคั่ว", qtyBaseUnit: 18, baseUnit: "g" },
      { ingredientName: "นมสด", qtyBaseUnit: 200, baseUnit: "ml" },
    ],
  },
  {
    name: "คาปูชิโน่",
    aliases: ["คาปูชิโน", "คาปูชิโน่ร้อน", "คาปูชิโน่เย็น", "cappuccino"],
    lines: [
      { ingredientName: "เมล็ดกาแฟคั่ว", qtyBaseUnit: 18, baseUnit: "g" },
      { ingredientName: "นมสด", qtyBaseUnit: 150, baseUnit: "ml" },
    ],
  },
  {
    name: "มอคค่า",
    aliases: ["มอคค่าร้อน", "มอคค่าเย็น", "มอคค่าปั่น", "มอคคา", "mocha"],
    lines: [
      { ingredientName: "เมล็ดกาแฟคั่ว", qtyBaseUnit: 18, baseUnit: "g" },
      { ingredientName: "นมสด", qtyBaseUnit: 180, baseUnit: "ml" },
      { ingredientName: "ไซรัปช็อกโกแลต", qtyBaseUnit: 30, baseUnit: "ml" },
    ],
  },
  {
    name: "ชาไทยเย็น",
    aliases: ["ชาไทย", "ชาไทยร้อน", "ชาเย็น", "thai tea"],
    lines: [
      { ingredientName: "ชาไทย", qtyBaseUnit: 20, baseUnit: "g" },
      { ingredientName: "นมข้นหวาน", qtyBaseUnit: 100, baseUnit: "ml" },
      { ingredientName: "น้ำเชื่อม", qtyBaseUnit: 50, baseUnit: "g" },
    ],
  },
  {
    name: "มัทฉะลาเต้",
    aliases: ["มัทฉะ", "มัทฉะลาเต้ร้อน", "มัทฉะลาเต้เย็น", "matcha latte", "matcha"],
    lines: [
      { ingredientName: "ผงมัทฉะ", qtyBaseUnit: 5, baseUnit: "g" },
      { ingredientName: "นมสด", qtyBaseUnit: 200, baseUnit: "ml" },
    ],
  },
  {
    name: "โกโก้",
    aliases: ["โกโก้ร้อน", "โกโก้เย็น", "โกโก้ปั่น", "cocoa", "chocolate"],
    lines: [
      { ingredientName: "ผงโกโก้", qtyBaseUnit: 25, baseUnit: "g" },
      { ingredientName: "นมสด", qtyBaseUnit: 200, baseUnit: "ml" },
    ],
  },
];

// Modifiers a Thai drink name commonly carries that say nothing about which
// STANDARD recipe applies (temperature/texture, not identity) -- stripped
// from the end of the name (repeatedly, since "เย็นปั่น" stacks) before
// comparing against the library. Order matters: try longer modifiers first
// so "ปั่น" doesn't get half-stripped out of a word that merely contains it.
const STRIP_SUFFIXES = ["ร้อน", "เย็น", "ปั่น"];

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function stripModifiers(normalized: string): string {
  let s = normalized;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of STRIP_SUFFIXES) {
      if (s.length > suffix.length && s.endsWith(suffix)) {
        s = s.slice(0, s.length - suffix.length);
        changed = true;
      }
    }
  }
  return s;
}

/** Classic edit-distance DP -- operates on JS string indices (UTF-16 code
 * units). Thai combining vowels/tone marks occasionally being counted as
 * their own "character" only makes near-miss spelling MORE forgiving here,
 * never less, so it doesn't need special-casing for this approximate-match
 * purpose. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 1.0 = identical, 0.0 = nothing in common. */
function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

const MIN_CANDIDATE_LENGTH = 3;

/** The modifier-stripped form, UNLESS stripping leaves too little behind to
 * mean anything on its own (e.g. "ชาเย็น" strips to a bare "ชา", "tea" --
 * too generic to anchor a match) -- in which case the full normalized form
 * is used instead, so a short residual core never manufactures a false
 * "exact" or "prefix" hit against an unrelated short input. */
function coreForm(normalized: string): string {
  const stripped = stripModifiers(normalized);
  return stripped.length >= MIN_CANDIDATE_LENGTH ? stripped : normalized;
}

function scoreCandidate(rawInput: string, inputCore: string, candidate: string): number {
  const normCandidate = normalize(candidate);
  if (rawInput === normCandidate) return 1;

  const candidateCore = coreForm(normCandidate);
  if (inputCore === candidateCore) return 0.95;

  if (candidateCore.length >= MIN_CANDIDATE_LENGTH && inputCore.length >= MIN_CANDIDATE_LENGTH) {
    if (inputCore.startsWith(candidateCore) || candidateCore.startsWith(inputCore)) {
      return 0.85;
    }
  }

  return similarity(inputCore, candidateCore);
}

/** Never offer a poor match -- a wrong suggestion teaches the merchant the
 * feature is unreliable, which is worse than no suggestion at all. Tuned
 * high enough that an unrelated short name (e.g. "ชา" alone) does not
 * accidentally clear it against "ชาไทยเย็น". */
export const SUGGESTION_THRESHOLD = 0.72;

/**
 * Fuzzy, Thai-aware match of a menu item's name against the seed library.
 * Returns the single best-scoring entry, or null if nothing clears
 * SUGGESTION_THRESHOLD -- callers must never fall back to "closest anyway".
 */
export function matchRecipeSuggestion(
  itemName: string,
  library: RecipeLibraryEntry[] = RECIPE_LIBRARY,
): RecipeLibraryEntry | null {
  const rawInput = normalize(itemName);
  if (rawInput.length === 0) return null;
  const inputCore = coreForm(rawInput);

  let best: RecipeLibraryEntry | null = null;
  let bestScore = 0;

  for (const entry of library) {
    const candidates = [entry.name, ...entry.aliases];
    for (const candidate of candidates) {
      const score = scoreCandidate(rawInput, inputCore, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
  }

  return bestScore >= SUGGESTION_THRESHOLD ? best : null;
}
