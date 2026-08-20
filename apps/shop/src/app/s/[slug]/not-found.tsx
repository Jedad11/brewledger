// docs/design/state_matrix.md "เมนูร้าน /s/{slug}" — Not found / unpublished.
// Next serves this with an HTTP 404 status and no stack trace whenever
// notFound() is called in page.tsx (store row missing, or is_published
// false — both cases are indistinguishable by design, see the state
// matrix note this file's copy comes from).
import { EmptyState } from "@brewledger/ui";
import { NOT_FOUND_BODY, NOT_FOUND_TITLE } from "@/lib/copy";

export default function StoreNotFound() {
  return (
    <div className="cw">
      <div className="cw-body">
        <EmptyState title={NOT_FOUND_TITLE} body={NOT_FOUND_BODY} />
      </div>
    </div>
  );
}
