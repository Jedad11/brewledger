// WBS 6.7 -- the matcher's own acceptance criterion: "never offer a poor
// match ... offer nothing if it does not [clear the threshold]." Tested at
// the pure-function level, same posture as ./preview.test.ts.
import { describe, expect, it } from "vitest";
import { matchRecipeSuggestion, RECIPE_LIBRARY } from "./library";

describe("matchRecipeSuggestion — exact and near-exact names", () => {
  it("matches every seed entry's own canonical name exactly", () => {
    for (const entry of RECIPE_LIBRARY) {
      expect(matchRecipeSuggestion(entry.name)?.name).toBe(entry.name);
    }
  });

  it("matches every declared alias back to its own entry", () => {
    for (const entry of RECIPE_LIBRARY) {
      for (const alias of entry.aliases) {
        expect(matchRecipeSuggestion(alias)?.name).toBe(entry.name);
      }
    }
  });
});

describe("matchRecipeSuggestion — Thai-aware normalisation", () => {
  it("ignores surrounding/internal whitespace", () => {
    expect(matchRecipeSuggestion("  ลาเต้   ")?.name).toBe("ลาเต้");
  });

  it("strips ร้อน/เย็น/ปั่น modifier suffixes that don't change which standard recipe applies", () => {
    expect(matchRecipeSuggestion("คาปูชิโน่ร้อน")?.name).toBe("คาปูชิโน่");
    expect(matchRecipeSuggestion("มอคค่าปั่น")?.name).toBe("มอคค่า");
  });

  it("still matches through a long real-world name carrying extra modifiers beyond the ones this matcher explicitly strips (CLAUDE.md's own 40-char Thai stress string)", () => {
    expect(matchRecipeSuggestion("ลาเต้เย็นหวานน้อยพิเศษเพิ่มช็อต")?.name).toBe("ลาเต้");
  });

  it("tolerates a one-character spelling slip", () => {
    expect(matchRecipeSuggestion("อเมริกาโน")?.name).toBe("อเมริกาโน่");
  });
});

describe("matchRecipeSuggestion — never offers a poor match", () => {
  it("returns null for an empty name", () => {
    expect(matchRecipeSuggestion("")).toBeNull();
    expect(matchRecipeSuggestion("   ")).toBeNull();
  });

  it("returns null for a name unrelated to anything in the library", () => {
    expect(matchRecipeSuggestion("แซนด์วิชแฮมชีส")).toBeNull();
    expect(matchRecipeSuggestion("ครัวซองต์เนยสด")).toBeNull();
  });

  it("returns null rather than a false-positive on a short substring that happens to overlap a longer name", () => {
    // "ชา" alone must not clear the threshold against "ชาไทยเย็น" -- an
    // unrelated short name matching a much longer one is exactly the kind of
    // "wrong suggestion" this entry says is worse than no suggestion.
    expect(matchRecipeSuggestion("ชา")).toBeNull();
  });
});

describe("matchRecipeSuggestion — each seed entry's own line shape", () => {
  it("เอสเพรสโซ่ is 18 g roasted coffee bean, nothing else", () => {
    const entry = matchRecipeSuggestion("เอสเพรสโซ่");
    expect(entry?.lines).toEqual([{ ingredientName: "เมล็ดกาแฟคั่ว", qtyBaseUnit: 18, baseUnit: "g" }]);
  });

  it("ชาไทยเย็น has three lines: tea, condensed/evaporated milk, sugar syrup", () => {
    const entry = matchRecipeSuggestion("ชาไทยเย็น");
    expect(entry?.lines).toHaveLength(3);
    expect(entry?.lines.map((l) => l.ingredientName)).toEqual(["ชาไทย", "นมข้นหวาน", "น้ำเชื่อม"]);
  });
});
