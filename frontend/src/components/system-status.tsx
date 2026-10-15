"use client";

import { useEffect, useState } from "react";
import { API_URL, fetchReadiness, type ReadinessReport } from "@/lib/api";

const REFRESH_MS = 5_000;

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; report: ReadinessReport };

export function SystemStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const report = await fetchReadiness(controller.signal);
        setState({ kind: "ready", report });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : "Unknown error" });
      }
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  if (state.kind === "loading") {
    return <p className="text-sm text-neutral-500">Checking services…</p>;
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        <p className="font-medium">Cannot reach the API at {API_URL}</p>
        <p className="mt-1 opacity-80">{state.message}</p>
      </div>
    );
  }

  const { report } = state;
  return (
    <div className="w-full">
      <p className="mb-3 text-sm">
        Overall:{" "}
        <span className={report.status === "ok" ? "font-semibold text-green-600" : "font-semibold text-red-600"}>
          {report.status === "ok" ? "All systems ready" : "Degraded"}
        </span>
      </p>
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {Object.entries(report.checks).map(([name, check]) => (
          <li key={name} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="flex items-center gap-2 font-medium capitalize">
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${check.status === "up" ? "bg-green-500" : "bg-red-500"}`}
              />
              {name}
            </span>
            <span className="text-right text-neutral-500">
              {check.status === "up" ? (check.details ?? "up") : check.error} · {check.latencyMs} ms
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
