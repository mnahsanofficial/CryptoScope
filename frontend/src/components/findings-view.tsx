"use client";

import { useEffect, useState } from "react";
import { queryString } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useScanEvents } from "@/lib/scan-events-context";
import type { Finding, FindingCategory, Paginated, Severity } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Card, ErrorNote, Pagination, RiskBadge, Skeleton, tableClasses as t } from "./ui/primitives";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const CATEGORIES: FindingCategory[] = ["certificate", "protocol", "quantum"];
const inputClass = "rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-accent";

interface RuleMeta {
  id: string;
  title: string;
}

export function FindingsView() {
  const { finishedCount } = useScanEvents();
  const [severities, setSeverities] = useState<Severity[]>(["critical", "high"]);
  const [category, setCategory] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [latestOnly, setLatestOnly] = useState(true);
  const [sort, setSort] = useState("createdAt");
  const [page, setPage] = useState(1);

  /** Changing a filter always starts again at page 1. */
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };

  const rules = useApi<{ rules: RuleMeta[] }>("/risk/rules");
  const path = `/findings${queryString({ severity: severities, category, ruleId, latestOnly, sort, order: "desc", page, pageSize: 20 })}`;
  const findings = useApi<Paginated<Finding>>(path);
  const { reload } = findings;
  useEffect(() => {
    if (finishedCount > 0) reload();
  }, [finishedCount, reload]);

  const toggleSeverity = (s: Severity) =>
    filter(setSeverities)(severities.includes(s) ? severities.filter((x) => x !== s) : [...severities, s]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
        <p className="text-sm text-ink-2">Problems found by the risk rules, with the evidence and what to do about them.</p>
      </div>

      <Card>
        {/* Filters: one row above the table */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Severity" className="flex gap-1">
            {SEVERITIES.map((s) => {
              const on = severities.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSeverity(s)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${on ? "border-accent bg-accent-soft font-medium text-ink" : "border-hairline text-ink-2 hover:bg-surface-2"}`}
                >
                  {s[0].toUpperCase() + s.slice(1)}
                </button>
              );
            })}
          </div>
          <select aria-label="Category" value={category} onChange={(e) => filter(setCategory)(e.target.value)} className={inputClass}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <select aria-label="Rule" value={ruleId} onChange={(e) => filter(setRuleId)(e.target.value)} className={`${inputClass} max-w-64`}>
            <option value="">All rules</option>
            {rules.data?.rules.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
          <select aria-label="Sort by" value={sort} onChange={(e) => filter(setSort)(e.target.value)} className={inputClass}>
            <option value="createdAt">Newest first</option>
            <option value="severity">Most severe first</option>
          </select>
          <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={latestOnly} onChange={(e) => filter(setLatestOnly)(e.target.checked)} />
            Current only (latest scan)
          </label>
        </div>

        {findings.error && <ErrorNote message={findings.error} />}
        {!findings.data && !findings.error ? (
          <Skeleton className="h-96" />
        ) : (
          <div className="overflow-x-auto">
            <table className={t.table}>
              <thead>
                <tr>
                  <th className={t.th}>Severity</th>
                  <th className={t.th}>Finding</th>
                  <th className={t.th}>Host</th>
                  <th className={t.th}>Found</th>
                </tr>
              </thead>
              <tbody className={findings.loading ? "opacity-60" : ""}>
                {findings.data?.data.map((f) => (
                  <tr key={f.id}>
                    <td className={`${t.td} whitespace-nowrap`}><RiskBadge level={f.severity} /></td>
                    <td className={t.td}>
                      <p className="font-medium">{f.title}</p>
                      <p className="mt-0.5 text-ink-2">{f.description}</p>
                      <details className="mt-1 text-ink-2">
                        <summary className="cursor-pointer text-xs text-accent">Recommendation</summary>
                        <p className="mt-1">{f.recommendation}</p>
                      </details>
                    </td>
                    <td className={`${t.td} whitespace-nowrap`}>
                      {f.asset.host}
                      {f.asset.port !== 443 && <span className="text-ink-muted">:{f.asset.port}</span>}
                    </td>
                    <td className={`${t.td} whitespace-nowrap text-ink-2`}>{formatDate(f.createdAt)}</td>
                  </tr>
                ))}
                {findings.data?.data.length === 0 && (
                  <tr>
                    <td className={`${t.td} text-ink-2`} colSpan={4}>No findings match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {findings.data && (
          <Pagination page={findings.data.meta.page} totalPages={findings.data.meta.totalPages} total={findings.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
