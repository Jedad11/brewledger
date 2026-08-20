// docs/design/state_matrix.md "เมนูร้าน /s/{slug}" — Loading: skeleton rows,
// no text. Next wraps the async StorePage in a Suspense boundary and shows
// this automatically while its data fetches resolve.
const SKELETON_ROW_COUNT = 4;

export default function StorePageLoading() {
  return (
    <div className="cw">
      <header className="cw-header">
        <span className="name">&nbsp;</span>
      </header>
      <div className="cw-body">
        <div className="animate-pulse rounded-(--radius-card) bg-black/5" style={{ height: 76 }} aria-hidden="true" />
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-(--radius-card) bg-black/5"
            style={{ height: 64 }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}
