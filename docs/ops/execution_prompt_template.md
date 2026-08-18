# Execution Prompt Template

Copy this, fill in `{WBS_CODE}`, and use it to dispatch a subagent against a
specific WBS entry.

```
Work item: WBS {WBS_CODE} from BrewLedger_WBS_Dictionary.md.

Before doing anything:
1. Read the full entry for WBS {WBS_CODE} in ./BrewLedger_WBS_Dictionary.md.
2. Read PROGRESS.md and find the row for {WBS_CODE}. If Status is already
   "done" or "needs review", STOP and report back instead of duplicating work.
   If Status is "pre-existing (adapt, do not scaffold)", read
   docs/ops/migration_notes.md in full before proceeding — do not run the
   dictionary's Claude Code prompt verbatim.
3. Determine the correct call pattern from .claude/agents/WORKFLOW.md:
   - Pattern A (architect → engineer → qa_engineer → redline_reviewer)
     for schema/structural entries.
   - Pattern B (engineer → qa_engineer → redline_reviewer) for
     fully-specified backend entries.
   - Pattern C (engineer → redline_reviewer) for screen/UI entries.
   Dispatch the agents in that order, in separate sessions (writer and
   reviewer must never be the same agent/session).

Guardrail — read this if {WBS_CODE} touches apps/shop, apps/console, or
Vercel in any way:
   apps/shop is LIVE IN PRODUCTION on Vercel, linked to an active QR code
   submitted for a competition. Do not overwrite, redeploy-from-scratch,
   rename, or relink the existing Vercel project. Do not run any dictionary
   prompt language implying "scaffold apps/shop" or "create new Vercel
   project" without first reading docs/ops/migration_notes.md. All new
   routes/features must be added via normal PR plus preview-deploy against
   the existing project. If in doubt, stop and ask before touching anything
   under apps/shop/ or apps/console/ or any Vercel project settings.

After implementation:
   The engineer/architect leg sets PROGRESS.md Status to "needs review" and
   fills in Implemented-by plus commit ref. Do NOT mark "done" yourself.

After review:
   The qa_engineer/redline_reviewer leg sets PROGRESS.md Status to "done"
   and fills in Reviewed-by. Only invoke redline_reviewer for
   schema/payment/Customer-Web changes per WORKFLOW.md; qa_engineer alone
   is sufficient for non-gate commits.

Do not push to origin without explicit user confirmation.
```
