import { log } from "../log";
import { generateSlots } from "./slots";
import { expireOrders } from "./expireOrders";
import type { Job, JobHandler } from "./types";

// Stub — real logic lands with the OCR WBS entries (6.x). Reads a purchase
// invoice image, calls Typhoon OCR, stores raw extraction for review.
const ocrExtract: JobHandler = async (job) => {
  log.info("stub handler invoked: ocr_extract", { job_id: job.id, job_type: job.job_type });
};

// Stub — real logic lands with the costing WBS entries (6.x). Recomputes
// ingredients.current_unit_cost_satang and downstream cost-per-cup.
const costRecalc: JobHandler = async (job) => {
  log.info("stub handler invoked: cost_recalc", { job_id: job.id, job_type: job.job_type });
};

// Stub — real logic lands with the reporting WBS entries (7.x). Rolls up
// daily_financials for the dashboard and P&L.
const dailyAggregate: JobHandler = async (job) => {
  log.info("stub handler invoked: daily_aggregate", { job_id: job.id, job_type: job.job_type });
};

// Stub — real logic lands with WBS 7.3/7.4. Compares current vs snapshot
// ingredient cost and raises an alert on significant drift.
const costDriftCheck: JobHandler = async (job) => {
  log.info("stub handler invoked: cost_drift_check", { job_id: job.id, job_type: job.job_type });
};

// Stub — real logic lands with WBS 6.8. Checks stock_ledger balances against
// low-stock thresholds and enqueues push_notify jobs.
const lowStockCheck: JobHandler = async (job) => {
  log.info("stub handler invoked: low_stock_check", { job_id: job.id, job_type: job.job_type });
};

// Stub — real logic lands with the notification WBS entries. Sends a Web
// Push (VAPID) notification; polling fallback is handled client-side.
const pushNotify: JobHandler = async (job) => {
  log.info("stub handler invoked: push_notify", { job_id: job.id, job_type: job.job_type });
};

export const handlers: Record<string, JobHandler> = {
  ocr_extract: ocrExtract,
  cost_recalc: costRecalc,
  daily_aggregate: dailyAggregate,
  cost_drift_check: costDriftCheck,
  low_stock_check: lowStockCheck,
  push_notify: pushNotify,
  generate_slots: generateSlots,
  expire_orders: expireOrders,
};

export function getHandler(jobType: string): JobHandler | undefined {
  return handlers[jobType];
}

export type { Job, JobHandler };
