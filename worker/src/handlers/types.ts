export interface Job {
  id: string;
  store_id: string | null;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export type JobHandler = (job: Job) => Promise<void>;
