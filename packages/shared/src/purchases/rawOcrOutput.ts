// WBS 6.1 — shape of purchase_invoices.raw_ocr_output for a manually typed
// bill (ocr_status = 'manual'). Nothing here is OCR output in the literal
// sense: purchase_line_items can't be written at WBS 6.1's submit time
// because qty_base_unit/unit_cost_satang are defined in BASE units
// (packages/costing/src/units.ts), and converting a typed "5 kg" into base
// units needs an ingredient chosen first — that mapping is WBS 6.4's job,
// done inside its own confirm transaction. This column is reused as the
// parking spot for "unstructured per-line data awaiting that confirm step",
// regardless of whether it came from a keyboard (this entry) or a vision
// model (WBS 6.2/6.3, deferred) — hence a `source` tag instead of assuming
// OCR. WBS 6.4 reads this exact shape back to pre-fill its review form; do
// not change it without checking that reader.
export interface ManualRawPurchaseLineItem {
  name: string;
  /** As typed, e.g. "5" or "2.5" — NOT converted to base units. */
  qtyText: string;
  /** As typed, e.g. "kg", "ขวด" — NOT normalized against ingredients.base_unit. */
  unitText: string;
  /** Integer satang, still denominated in the merchant's typed PURCHASE unit, not base unit. */
  unitCostSatang: number;
  /** Integer satang, qty * unitCostSatang as typed. */
  totalSatang: number;
}

export interface ManualRawOcrOutput {
  source: "manual";
  version: 1;
  lineItems: ManualRawPurchaseLineItem[];
}
