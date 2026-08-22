// WBS 6.5 -- Ingredient Master and Unit Conversion.
//
// CORE RULE: everything is stored in BASE UNITS (g, ml, piece). Purchases
// arrive in kg, L, packs, dozens; recipes are written in g and ml. Mixing
// the two is how cost arithmetic goes wrong by a factor of 1000 and nobody
// notices until the profit report looks insane. Normalise on entry, store
// base units only, convert for display -- this module is that normalisation
// boundary, and the ONLY place a purchase-unit quantity/cost should be
// converted into base-unit terms anywhere in the codebase.

/** The only three units `ingredients.base_unit` (0008_ingredients.sql's
 * CHECK constraint) allows, and the only units bom_lines/stock_ledger
 * quantities are ever expressed in. */
export type BaseUnit = "g" | "ml" | "piece";

/** Every unit a purchase line can arrive in. Each belongs to exactly one of
 * three families -- mass (kg/g), volume (L/ml), or count (dozen/pack/piece)
 * -- and only converts into the BaseUnit of its own family. */
export type PurchaseUnit = "kg" | "g" | "L" | "ml" | "dozen" | "pack" | "piece";

const UNIT_FAMILY: Record<PurchaseUnit, BaseUnit> = {
  kg: "g",
  g: "g",
  L: "ml",
  ml: "ml",
  dozen: "piece",
  pack: "piece",
  piece: "piece",
};

/** Multiplier from one unit of `fromUnit` into its base unit, for every
 * family member EXCEPT `pack` (pack's multiplier is the ingredient's own
 * `pack_size`, supplied by the caller -- see toBaseUnit below). */
const FIXED_MULTIPLIER: Partial<Record<PurchaseUnit, number>> = {
  kg: 1000, // 1 kg = 1000 g
  g: 1,
  L: 1000, // 1 L = 1000 ml
  ml: 1,
  dozen: 12, // 1 dozen = 12 piece
  piece: 1,
};

/**
 * Converts a purchase-unit quantity into the ingredient's base-unit
 * quantity. Throws on an incompatible pair (e.g. `kg` into a `ml` base
 * unit) rather than silently coercing -- a merchant fat-fingering the wrong
 * purchase unit for an ingredient must get a loud error, not a quietly
 * wrong number three screens later.
 *
 * `packSize` (pieces per pack) is REQUIRED when `fromUnit === "pack"` and
 * ignored otherwise. This is the one addition beyond the WBS 6.5 prompt's
 * literal 3-argument signature -- the prompt's own conversion table asks
 * for "pack->piece (with a per-ingredient pack size)", which is not
 * expressible without the caller supplying that pack size somehow. Adding
 * it as an explicit optional parameter (rather than, say, a hidden global
 * lookup) keeps this function pure and keeps the ingredient's pack_size
 * column (packages/db/migrations/0036) the caller's concern, not this
 * module's.
 */
export function toBaseUnit(
  qty: number,
  fromUnit: PurchaseUnit,
  baseUnit: BaseUnit,
  packSize?: number,
): number {
  const family = UNIT_FAMILY[fromUnit];
  if (family === undefined) {
    throw new Error(`toBaseUnit: unknown unit "${fromUnit}"`);
  }
  if (family !== baseUnit) {
    throw new Error(
      `toBaseUnit: incompatible unit pair -- cannot convert "${fromUnit}" (a ${family} unit) into base unit "${baseUnit}". Mass, volume, and count units never mix.`,
    );
  }

  if (fromUnit === "pack") {
    if (packSize === undefined || packSize === null || !(packSize > 0)) {
      throw new Error(
        `toBaseUnit: "pack" requires a positive packSize (pieces per pack) -- none given. This is the ingredient's own pack_size column (packages/db/migrations/0036_ingredient_master_conversions.sql), not a default this function may invent.`,
      );
    }
    return qty * packSize;
  }

  const multiplier = FIXED_MULTIPLIER[fromUnit];
  if (multiplier === undefined) {
    // Unreachable given UNIT_FAMILY/FIXED_MULTIPLIER are kept in lockstep
    // for every PurchaseUnit except "pack" (handled above) -- kept as a
    // real throw, not an `as never` cast, so a future PurchaseUnit added to
    // one map but not the other fails loudly at the call site instead of
    // silently returning NaN.
    throw new Error(`toBaseUnit: no fixed multiplier registered for unit "${fromUnit}"`);
  }
  return qty * multiplier;
}

/**
 * Cost per base unit, in satang, for a purchase line. This is the single
 * function that turns "I paid 45,000 satang (450 THB) for 1 kg" into
 * "45 satang per gram" -- get the unit conversion wrong here and every
 * downstream cost/margin number is off by whatever factor (typically 1000,
 * kg vs g or L vs ml) the mixed units introduced.
 *
 * Returns a raw (possibly fractional) number of satang per base unit --
 * rounding to an integer before persisting into an `integer` satang column
 * (e.g. `ingredients.current_unit_cost_satang`, WBS 6.6's job) is the
 * CALLER's responsibility. This function only converts units; it does not
 * decide how the result gets written to money storage.
 */
export function costPerBaseUnit(
  totalSatang: number,
  qty: number,
  unit: PurchaseUnit,
  baseUnit: BaseUnit,
  packSize?: number,
): number {
  const baseQty = toBaseUnit(qty, unit, baseUnit, packSize);
  if (!(baseQty > 0)) {
    throw new Error(`costPerBaseUnit: converted quantity must be > 0, got ${baseQty}`);
  }
  return totalSatang / baseQty;
}

/** The human-scale purchase unit a base unit is displayed in -- a merchant
 * thinks in kilograms and litres, not grams and millilitres. */
const HUMAN_UNIT: Record<BaseUnit, { label: string; multiplier: number }> = {
  g: { label: "กก.", multiplier: 1000 }, // per-gram cost -> per-kg
  ml: { label: "ล.", multiplier: 1000 }, // per-ml cost -> per-litre
  piece: { label: "ชิ้น", multiplier: 1 },
};

/**
 * Converts a per-base-unit satang cost into a per-human-unit satang cost
 * plus its Thai label, for display only (WBS 6.5 prompt point 2: show
 * "45 บาท/กก." not "4.5 สตางค์/กรัม"). Pure unit conversion -- money
 * formatting (the "฿"/"บาท" string, decimal places) is the caller's job,
 * same division of labour as packages/ui/src/components/MoneyValue.tsx.
 */
export function costPerHumanUnit(
  costPerBaseUnitSatang: number,
  baseUnit: BaseUnit,
): { satangPerHumanUnit: number; label: string } {
  const { label, multiplier } = HUMAN_UNIT[baseUnit];
  return { satangPerHumanUnit: costPerBaseUnitSatang * multiplier, label };
}
