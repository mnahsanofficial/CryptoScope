import { initialScanEventsState, MAX_TRACKED_JOBS, overallProgress, scanEventsReducer, type ScanEvent } from "@/lib/scan-events-reducer";
import type { ScanProgress } from "@/lib/types";

const progress = (jobId: string, stage: ScanProgress["stage"], percent: number): ScanProgress => ({
  jobId,
  assetId: "a1",
  scanId: jobId,
  batchId: null,
  stage,
  percent,
  attempt: 1,
  maxAttempts: 3,
});

const apply = (...events: ScanEvent[]) => events.reduce(scanEventsReducer, initialScanEventsState);
const scan = (p: ScanProgress): ScanEvent => ({ type: "scan.progress", payload: p });

describe("scanEventsReducer", () => {
  it("keeps the latest event per job, newest job first", () => {
    const state = apply(scan(progress("j1", "queued", 0)), scan(progress("j2", "queued", 0)), scan(progress("j1", "scanning", 25)));

    expect(state.jobs.map((j) => [j.jobId, j.stage])).toEqual([
      ["j1", "scanning"],
      ["j2", "queued"],
    ]);
  });

  it("keeps the last readable message when a later stage has none", () => {
    const state = apply(scan({ ...progress("j1", "scanning", 25), message: "Connecting to github.com:443" }), scan(progress("j1", "saving", 60)));
    expect(state.jobs[0]).toMatchObject({ stage: "saving", message: "Connecting to github.com:443" });
  });

  it("counts each finished job once, so pages reload exactly once per scan", () => {
    const state = apply(scan(progress("j1", "completed", 100)), scan(progress("j1", "completed", 100)), scan(progress("j2", "failed", 100)));
    expect(state.finishedCount).toBe(2);
  });

  it("never moves a finished job back to running when an old event arrives late", () => {
    const state = apply(scan(progress("j1", "completed", 100)), scan(progress("j1", "indexing", 80)));
    expect(state.jobs[0].stage).toBe("completed");
  });

  it("ignores a stale batch update with lower counts", () => {
    const batch = (completed: number) => ({ type: "batch.progress" as const, payload: { batchId: "b1", total: 4, completed, failed: 0, percent: completed * 25 } });
    const state = apply(batch(3), batch(2));
    expect(state.batches.b1.completed).toBe(3);
  });

  it("clear-finished removes finished jobs and completed batches", () => {
    const state = apply(
      scan(progress("j1", "completed", 100)),
      scan(progress("j2", "scanning", 25)),
      { type: "batch.progress", payload: { batchId: "b1", total: 1, completed: 1, failed: 0, percent: 100 } },
      { type: "clear-finished" },
    );
    expect(state.jobs.map((j) => j.jobId)).toEqual(["j2"]);
    expect(state.batches).toEqual({});
  });

  it(`tracks at most ${MAX_TRACKED_JOBS} jobs`, () => {
    const events = Array.from({ length: MAX_TRACKED_JOBS + 10 }, (_, i) => scan(progress(`j${i}`, "queued", 0)));
    expect(apply(...events).jobs).toHaveLength(MAX_TRACKED_JOBS);
  });

  it("overallProgress averages the tracked jobs", () => {
    const state = apply(scan(progress("j1", "completed", 100)), scan(progress("j2", "scanning", 20)));
    expect(overallProgress(state)).toEqual({ active: 1, finished: 1, percent: 60 });
  });
});

describe("chart helpers", () => {
  // Imported here to keep the chart tests next to the other pure-logic tests.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { niceTicks, completeBuckets } = require("@/components/charts") as typeof import("@/components/charts");

  it("niceTicks gives clean round steps", () => {
    expect(niceTicks(2187)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    expect(niceTicks(9)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0)).toEqual([0]);
  });

  it("completeBuckets drops the bucket that is still in progress", () => {
    const buckets = ["10:00", "11:00", "12:00"].map((t) => ({ timestamp: `2026-06-01T${t}:00.000Z` }));
    expect(completeBuckets(buckets, Date.parse("2026-06-01T12:30:00Z")).map((b) => b.timestamp.slice(11, 16))).toEqual(["10:00", "11:00"]);
  });
});
