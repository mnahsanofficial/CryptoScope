"use client";

import { useScanEvents } from "@/lib/scan-events-context";
import { isFinished, overallProgress } from "@/lib/scan-events-reducer";
import type { ScanProgress } from "@/lib/types";
import { Button, ProgressBar } from "./ui/primitives";

const STAGE_LABEL: Record<ScanProgress["stage"], string> = {
  queued: "Queued",
  scanning: "Scanning",
  saving: "Saving",
  indexing: "Indexing",
  completed: "Done",
  retrying: "Retrying",
  failed: "Failed",
};

/** Floating panel with live scan progress pushed over Socket.IO. Hidden when nothing is being tracked. */
export function ScanProgressPanel() {
  const events = useScanEvents();
  const batches = Object.values(events.batches);
  if (events.jobs.length === 0 && batches.length === 0) return null;

  const overall = overallProgress(events);
  const allDone = overall.active === 0;

  return (
    <aside
      aria-live="polite"
      className="fixed bottom-4 right-4 z-10 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-hairline bg-surface p-4 shadow-lg"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {allDone ? "Scans finished" : `Scanning ${overall.active} ${overall.active === 1 ? "asset" : "assets"}`}
        </h2>
        <span className="text-xs text-ink-muted">{events.connection === "connected" ? "● live" : events.connection}</span>
      </div>

      {batches.map((batch) => (
        <div key={batch.batchId} className="mb-3">
          <div className="mb-1 flex justify-between text-xs text-ink-2">
            <span>Batch</span>
            <span className="tabular">
              {batch.completed + batch.failed}/{batch.total}
              {batch.failed > 0 ? ` · ${batch.failed} failed` : ""}
            </span>
          </div>
          <ProgressBar percent={batch.percent} label="Batch progress" />
        </div>
      ))}

      <ul className="max-h-56 space-y-2 overflow-y-auto">
        {events.jobs.slice(0, 8).map((job) => (
          <li key={job.jobId} className="text-xs">
            <div className="mb-1 flex justify-between gap-2">
              <span className="truncate text-ink-2" title={job.message}>
                {job.message ?? (job.stage === "queued" ? "Waiting in queue" : `Scan ${job.jobId.slice(0, 8)}`)}
              </span>
              <span className={`shrink-0 font-medium ${job.stage === "failed" ? "text-danger" : "text-ink"}`}>
                {STAGE_LABEL[job.stage]}
                {job.stage === "retrying" ? ` (${job.attempt}/${job.maxAttempts})` : ""}
              </span>
            </div>
            {!isFinished(job) && <ProgressBar percent={job.percent} label={`Scan ${job.jobId}`} />}
          </li>
        ))}
      </ul>

      {allDone && (
        <Button variant="secondary" className="mt-3 w-full" onClick={events.clearFinished}>
          Dismiss
        </Button>
      )}
    </aside>
  );
}
