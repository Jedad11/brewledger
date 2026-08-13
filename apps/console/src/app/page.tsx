export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-cream p-10 text-center">
      <span className="text-xs uppercase tracking-[0.24px] text-ink-muted">
        Brew Ledger
      </span>
      <h1 className="font-serif text-[96px] font-bold leading-none tracking-[-0.01em] text-brand">
        Coming soon.
      </h1>
      <p className="max-w-115 text-lg leading-[1.4] text-ink-muted text-pretty">
        Tax filing and cash-flow planning for one-person bars, built on the
        sales and receipts you already log.
      </p>
    </div>
  );
}
