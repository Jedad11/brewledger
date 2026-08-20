"use client";

// Error boundaries must be Client Components. Next.js 16 renamed the
// recovery callback from `reset` to `retry` — see
// apps/shop/node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md.
// docs/design/state_matrix.md "เมนูร้าน /s/{slug}" — Error: a single
// sentence, not a title/body pair. The retry button reuses that sentence's
// own trailing clause verbatim.
import { EmptyState } from "@brewledger/ui";
import { ERROR_MESSAGE, ERROR_RETRY_LABEL } from "@/lib/copy";

export default function StorePageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="cw">
      <div className="cw-body">
        <EmptyState title={ERROR_MESSAGE} body="" action={{ label: ERROR_RETRY_LABEL, onPress: retry }} />
      </div>
    </div>
  );
}
