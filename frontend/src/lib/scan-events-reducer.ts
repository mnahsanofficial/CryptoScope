import type { BatchProgress, ScanProgress } from "./types";

/** Live scan state built from Socket.IO events. Pure functions only, so it is easy to unit-test. */
export interface ScanEventsState {
  /** Latest event per job, newest job first. */
  jobs: ScanProgress[];
  batches: Record<string, BatchProgress>;
  /** Increases every time a job finishes, so pages know when to reload their data. */
  finishedCount: number;
}

export type ScanEvent =
  | { type: "scan.progress"; payload: ScanProgress }
  | { type: "batch.progress"; payload: BatchProgress }
  | { type: "clear-finished" };

export const MAX_TRACKED_JOBS = 50;
const FINISHED_STAGES = new Set(["completed", "failed"]);

export const initialScanEventsState: ScanEventsState = { jobs: [], batches: {}, finishedCount: 0 };

export function isFinished(job: ScanProgress): boolean {
  return FINISHED_STAGES.has(job.stage);
}

export function scanEventsReducer(state: ScanEventsState, event: ScanEvent): ScanEventsState {
  switch (event.type) {
    case "scan.progress": {
      const update = event.payload;
      const previous = state.jobs.find((j) => j.jobId === update.jobId);
      // Events can arrive out of order across connections; never move a finished job back to "running".
      if (previous && isFinished(previous) && !isFinished(update)) return state;

      const others = state.jobs.filter((j) => j.jobId !== update.jobId);
      const justFinished = isFinished(update) && !(previous && isFinished(previous));
      return {
        ...state,
        jobs: [update, ...others].slice(0, MAX_TRACKED_JOBS),
        finishedCount: state.finishedCount + (justFinished ? 1 : 0),
      };
    }
    case "batch.progress": {
      const current = state.batches[event.payload.batchId];
      // Counts only go up; ignore a stale event that arrives late.
      if (current && current.completed + current.failed > event.payload.completed + event.payload.failed) return state;
      return { ...state, batches: { ...state.batches, [event.payload.batchId]: event.payload } };
    }
    case "clear-finished": {
      const activeBatches = Object.fromEntries(Object.entries(state.batches).filter(([, b]) => b.percent < 100));
      return { ...state, jobs: state.jobs.filter((j) => !isFinished(j)), batches: activeBatches };
    }
  }
}

/** Overall progress of everything currently tracked (for one summary bar). */
export function overallProgress(state: ScanEventsState): { active: number; finished: number; percent: number } {
  const active = state.jobs.filter((j) => !isFinished(j)).length;
  const finished = state.jobs.length - active;
  const percent = state.jobs.length === 0 ? 0 : Math.round(state.jobs.reduce((sum, j) => sum + j.percent, 0) / state.jobs.length);
  return { active, finished, percent };
}
