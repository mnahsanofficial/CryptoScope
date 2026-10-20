"use client";

import { useState } from "react";
import { useScanEvents } from "@/lib/scan-events-context";
import { isFinished, overallProgress } from "@/lib/scan-events-reducer";
import { scanErrorLabel } from "@/lib/scan-errors";
import type { ScanProgress } from "@/lib/types";
import { ScanDetailsDialog, type OpenScan } from "./scan-details-dialog";
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

/**
 * A job can complete (it ran fine) while the scan itself failed (host unreachable): saying "Done" for
 * that would read as success, so the result decides the label.
 */
export function jobStatus(job: ScanProgress): { label: string; tone: "ok" | "bad" } {
  if (job.stage === "completed" && job.result?.status === "failed") return { label: scanErrorLabel(job.result.errorCode), tone: "bad" };
  const label = STAGE_LABEL[job.stage] + (job.stage === "retrying" ? ` (${job.attempt}/${job.maxAttempts})` : "");
  return { label, tone: job.stage === "failed" ? "bad" : "ok" };
}

/** Floating panel with live scan progress pushed over Socket.IO. Hidden when nothing is being tracked. */
export function ScanProgressPanel() {
  const events = useScanEvents();
  const [open, setOpen] = useState<OpenScan | null>(null);
  const batches = Object.values(events.batches);
  if (events.jobs.length === 0 && batches.length === 0) return null;

  const overall = overallProgress(events);
  const allDone = overall.active === 0;
  const failed = events.jobs.filter((j) => jobStatus(j).tone === "bad").length;

  return (
    <aside
      aria-live="polite"
      className="fixed bottom-4 right-4 z-10 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-hairline bg-surface p-4 shadow-lg"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {allDone ? "Scans finished" : `Scanning ${overall.active} ${overall.active === 1 ? "asset" : "assets"}`}
          {failed > 0 && <span className="font-normal text-danger"> · {failed} failed</span>}
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
        {events.jobs.slice(0, 8).map((job) => {
          const status = jobStatus(job);
          const text = job.message ?? (job.stage === "queued" ? "Waiting in queue" : `Scan ${job.jobId.slice(0, 8)}`);
          const line = (
            <>
              <span className="truncate text-ink-2" title={job.message}>{text}</span>
              <span className={`shrink-0 font-medium ${status.tone === "bad" ? "text-danger" : "text-ink"}`}>{status.label}</span>
            </>
          );
          // A completed job has a saved scan (successful or "unreachable"): its row opens the details.
          const host = job.message?.split(":")[0] ?? "Scan";
          return (
            <li key={job.jobId} className="text-xs">
              {job.stage === "completed" ? (
                <button
                  type="button"
                  onClick={() => setOpen({ scanId: job.scanId, host })}
                  title="Show findings"
                  className="-mx-1.5 flex w-[calc(100%+0.75rem)] justify-between gap-2 rounded px-1.5 py-0.5 text-left hover:bg-surface-2"
                >
                  {line}
                </button>
              ) : (
                <div className="mb-1 flex justify-between gap-2">{line}</div>
              )}
              {!isFinished(job) && <ProgressBar percent={job.percent} label={`Scan ${job.jobId}`} />}
            </li>
          );
        })}
      </ul>

      {allDone && (
        <>
          <p className="mt-2 text-[11px] text-ink-muted">Click a scan to see its findings.</p>
          <Button variant="secondary" className="mt-2 w-full" onClick={events.clearFinished}>
            Dismiss
          </Button>
        </>
      )}
      {open && <ScanDetailsDialog scan={open} onClose={() => setOpen(null)} />}
    </aside>
  );
}
