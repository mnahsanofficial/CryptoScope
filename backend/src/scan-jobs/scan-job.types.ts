import { RiskLevel } from '../risk/risk.types';

export const SCAN_QUEUE = 'scans';
export const SCAN_JOB = 'scan-asset';

/** What we put in Redis for each job. Kept small: ids only, the worker loads the rest. */
export interface ScanJobData {
  assetId: string;
  /** Decided when the job is created, so every retry writes the SAME scan row (idempotency). */
  scanId: string;
  /** Set when the job is part of a "scan many assets" request. */
  batchId: string | null;
}

export interface ScanJobResult {
  scanId: string;
  status: 'success' | 'failed';
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  errorCode: string | null;
  findingsIndexed: number;
}

export const SCAN_STAGES = ['queued', 'scanning', 'saving', 'indexing', 'completed', 'retrying', 'failed'] as const;
export type ScanStage = (typeof SCAN_STAGES)[number];

/** Rough progress per stage, for a progress bar. */
export const STAGE_PERCENT: Record<ScanStage, number> = {
  queued: 0,
  scanning: 25,
  saving: 60,
  indexing: 80,
  completed: 100,
  retrying: 10,
  failed: 100,
};

export interface BatchProgress {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  percent: number;
}

/**
 * Everything the UI needs about one job, sent as BullMQ "job progress".
 * BullMQ publishes progress through Redis, so ANY API instance can forward it to its Socket.IO clients,
 * even when the worker runs in a different process.
 */
export interface ScanProgress {
  jobId: string;
  assetId: string;
  scanId: string;
  batchId: string | null;
  stage: ScanStage;
  percent: number;
  attempt: number;
  maxAttempts: number;
  message?: string;
  result?: ScanJobResult;
  batch?: BatchProgress;
}

export function isScanProgress(value: unknown): value is ScanProgress {
  return typeof value === 'object' && value !== null && 'stage' in value && 'jobId' in value;
}
