-- WBS 6.1 -- schema blocker found while scoping Purchase / Bill Entry
-- (Manual). Two additive fixes to 0015_purchase_invoices.sql, both scoped
-- to purchase_invoices only -- 0016_purchase_line_items.sql and every other
-- WBS 3.5/6.5 table were read and found to need no change for 6.1.
--
-- 1. `image_path` NOT NULL -> nullable.
--    WBS 6.1's own acceptance criterion is "a merchant can complete a
--    purchase entry with or without attaching a photo" -- the photo is an
--    optional private reference image only (WBS Phase 6.0 banner: 6.2/6.3
--    OCR are deferred, so nothing ever reads this column back out for
--    extraction). A NOT NULL column cannot represent "no photo attached",
--    so every no-photo purchase entry would currently fail its INSERT.
--    Checked 0021_rls.sql's merchant_rw_purchase_invoices policy (lines
--    144-148): it scopes purely on `store_id in (select auth_store_ids())`
--    for both USING and WITH CHECK, nothing references image_path, so
--    nullability does not touch RLS.
--
-- 2. `ocr_status` default 'pending' -> 'manual'.
--    The check constraint already lists 'manual' as valid (0015 anticipated
--    this path) but the column default still implies "queued, a job will
--    process this" -- untrue for the entire Phase 6.0 manual-only period,
--    since no code enqueues or consumes an `ocr_extract` job against this
--    table (worker/src/handlers/index.ts's `ocrExtract` handler is a stub,
--    registered but never dispatched). Fixed at the DEFAULT rather than
--    left purely to the 6.1/6.4 insert code, so the correct value holds
--    even if a future write path (a fixture, a console script, a slip in
--    6.4's own insert) forgets to set it explicitly -- a stray 'pending'
--    row should be structurally hard to create, not just discouraged by
--    convention. The 6.1/6.4 insert should still set ocr_status: 'manual'
--    explicitly for its own readability; that is an application-level
--    decision for the follow-on engineer pass, not required for this
--    migration's correctness.
--
--    Backfilled: any existing 'pending' row is stale by construction (no
--    OCR path has ever run in this codebase to have produced it, and none
--    will until 6.2/6.3 are un-deferred) -- left as 'pending' it reads as
--    "queued", which is simply wrong. Table is expected to hold very few
--    rows during the manual-only period (no bulk seed/import path writes
--    purchase_invoices), so this UPDATE is not a lock-duration concern
--    against the free-tier performance fixture.
--
--    'pending' stays a valid check-constraint value: WBS 6.2/6.3, if
--    un-deferred later, still need it for the real OCR-queue path, and that
--    path's own insert will need to set ocr_status = 'pending' explicitly
--    at that point regardless of this column's default (explicit over
--    implicit is already this repo's own precedent for job-queue writes).

alter table purchase_invoices
  alter column image_path drop not null;

alter table purchase_invoices
  alter column ocr_status set default 'manual';

update purchase_invoices
  set ocr_status = 'manual'
  where ocr_status = 'pending';
