// WBS 6.4 -- read-only view for an invoice already confirmed (e.g. a
// merchant reopening this URL via back/forward/bookmark after confirming).
// The confirm RPC (packages/db/migrations/0044) is itself idempotent, but
// this page never re-renders the editable form for an already-confirmed
// invoice at all -- there is nothing left to edit, and no cost write can
// happen from here a second time.
import { Card, MoneyValue } from "@brewledger/ui";

export interface ConfirmedLine {
  id: string;
  label: string;
  ingredientName: string | null;
  totalSatang: number | null;
}

export function ConfirmedInvoiceView({
  vendorName,
  invoiceDate,
  totalSatang,
  lines,
}: {
  vendorName: string | null;
  invoiceDate: string | null;
  totalSatang: number | null;
  lines: ConfirmedLine[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-bold leading-[1.35] text-ink">ตรวจบิล</h1>
      <p className="note-plain">บิลนี้ยืนยันแล้ว</p>

      <Card>
        <div className="flex flex-col gap-3">
          {vendorName ? <p>{vendorName}</p> : null}
          {invoiceDate ? <p className="note-plain">{invoiceDate}</p> : null}

          <div className="flex flex-col gap-2 border-t border-black/10 pt-3">
            {lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate">{line.ingredientName ?? line.label}</p>
                  {line.ingredientName ? <p className="note-plain truncate">{line.label}</p> : null}
                </div>
                <MoneyValue value={line.totalSatang} role="cost" />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-black/10 pt-3">
            <span className="font-bold">รวมทั้งบิล</span>
            <MoneyValue value={totalSatang} role="cost" size="lg" />
          </div>
        </div>
      </Card>
    </div>
  );
}
