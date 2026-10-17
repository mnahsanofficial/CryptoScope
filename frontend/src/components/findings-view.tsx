"use client";

import { useEffect, useState } from "react";
import { queryString } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { useScanEvents } from "@/lib/scan-events-context";
import type { Finding, FindingCategory, FindingSearchResponse, Paginated, Severity } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useDebounced } from "@/lib/use-debounced";
import { Highlighted } from "./ui/highlighted";
import { Button, Card, ErrorNote, inputClass, Pagination, RiskBadge, SearchInput, Skeleton, tableClasses as t } from "./ui/primitives";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const CATEGORIES: FindingCategory[] = ["certificate", "protocol", "quantum"];

interface RuleMeta {
  id: string;
  title: string;
}

/** What one table row needs, whichever backend (PostgreSQL list or Elasticsearch search) produced it. */
interface Row {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  host: string;
  port: number;
  createdAt: string;
  highlight?: { title?: string; description?: string; host?: string };
}

const fromList = (f: Finding): Row => ({ ...f, host: f.asset.host, port: f.asset.port });

/**
 * Two modes, one page:
 *  - no search text: the PostgreSQL list (exact filters, sort by date or severity);
 *  - search text: Elasticsearch full-text search (relevance, typo tolerance, highlights, severity counts).
 */
export function FindingsView() {
  const { finishedCount } = useScanEvents();
  const [search, setSearch] = useState("");
  const [severities, setSeverities] = useState<Severity[]>(["critical", "high"]);
  const [category, setCategory] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [latestOnly, setLatestOnly] = useState(true);
  const [sort, setSort] = useState("createdAt");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  const searching = q.length > 0;
  /** Typed text not searched yet (debounce): dim the old rows so they don't pass for the new results. */
  const pending = search.trim() !== q;

  /** Changing a filter always starts again at page 1. */
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };

  const rules = useApi<{ rules: RuleMeta[] }>("/risk/rules");
  const listPath = `/findings${queryString({ severity: severities, category, ruleId, latestOnly, sort, order: "desc", page, pageSize: 20 })}`;
  const searchPath = `/findings/search${queryString({ q, severity: severities, category, ruleId, currentOnly: latestOnly, page, pageSize: 20 })}`;
  const list = useApi<Paginated<Finding>>(searching ? null : listPath);
  const results = useApi<FindingSearchResponse>(searching ? searchPath : null);
  const active = searching ? results : list;

  const { reload } = active;
  useEffect(() => {
    if (finishedCount > 0) reload();
  }, [finishedCount, reload]);

  const rows: Row[] = searching ? (results.data?.data ?? []) : (list.data?.data ?? []).map(fromList);
  const meta = searching ? results.data?.meta : list.data?.meta;
  const facets = searching ? results.data?.facets.severity : undefined;
  // Severity/category are post_filters, so the facet counts include matches those filters hide.
  const hiddenMatches = facets && meta?.total === 0 ? Object.values(facets).reduce((sum, n) => sum + n, 0) : 0;
  const showAllMatches = () => {
    setSeverities([...SEVERITIES]);
    setCategory("");
    setPage(1);
  };

  const toggleSeverity = (s: Severity) =>
    filter(setSeverities)(severities.includes(s) ? severities.filter((x) => x !== s) : [...severities, s]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
        <p className="text-sm text-ink-2">Problems found by the risk rules, with the evidence and what to do about them.</p>
      </div>

      <Card>
        {/* Search: free text over host, title, description and recommendation (Elasticsearch) */}
        <SearchInput
          label="Search findings"
          placeholder="Search host or text, e.g. expired cert…"
          value={search}
          onChange={filter(setSearch)}
          className="mb-3"
        />

        {/* Filters: one row above the table */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Severity" className="flex flex-wrap gap-1">
            {SEVERITIES.map((s) => {
              const on = severities.includes(s);
              const count = facets?.[s];
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSeverity(s)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${on ? "border-accent bg-accent-soft font-medium text-ink" : "border-hairline text-ink-2 hover:bg-surface-2"}`}
                >
                  {s[0].toUpperCase() + s.slice(1)}
                  {facets && <span className="tabular ml-1.5 text-ink-muted">{formatNumber(count ?? 0)}</span>}
                </button>
              );
            })}
          </div>
          <select aria-label="Category" value={category} onChange={(e) => filter(setCategory)(e.target.value)} className={`${inputClass} flex-1 sm:flex-none`}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <select aria-label="Rule" value={ruleId} onChange={(e) => filter(setRuleId)(e.target.value)} className={`${inputClass} min-w-0 flex-1 sm:max-w-64 sm:flex-none`}>
            <option value="">All rules</option>
            {rules.data?.rules.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
          {!searching && (
            <select aria-label="Sort by" value={sort} onChange={(e) => filter(setSort)(e.target.value)} className={`${inputClass} flex-1 sm:flex-none`}>
              <option value="createdAt">Newest first</option>
              <option value="severity">Most severe first</option>
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-ink-2 sm:ml-auto">
            <input type="checkbox" checked={latestOnly} onChange={(e) => filter(setLatestOnly)(e.target.checked)} />
            Current only (latest scan)
          </label>
        </div>

        {searching && results.data && (
          <p className="mb-2 text-xs text-ink-muted" aria-live="polite">
            {formatNumber(results.data.meta.total)} {results.data.meta.total === 1 ? "result" : "results"} for “{q}”, best matches first · Elasticsearch, {results.data.took} ms
          </p>
        )}

        {active.error && <ErrorNote message={active.error} />}
        {!active.data && !active.error ? (
          <Skeleton className="h-96" />
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead>
                <tr>
                  <th className={t.th}>Severity</th>
                  <th className={t.th}>Finding</th>
                  <th className={`${t.th} hidden md:table-cell`}>Host</th>
                  <th className={`${t.th} hidden sm:table-cell`}>Found</th>
                </tr>
              </thead>
              <tbody className={`transition-opacity ${active.loading || pending ? "opacity-50" : ""}`}>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td className={`${t.tdTop} whitespace-nowrap`}><RiskBadge level={f.severity} /></td>
                    <td className={t.tdTop}>
                      {/* On small screens the host (and date) columns are hidden, so they show here instead. */}
                      <p className="mb-0.5 text-xs text-ink-muted md:hidden">
                        <Highlighted text={f.host} highlighted={f.highlight?.host} />
                        {f.port !== 443 && `:${f.port}`}
                        <span className="whitespace-nowrap sm:hidden"> · {formatDate(f.createdAt)}</span>
                      </p>
                      <p className="font-medium"><Highlighted text={f.title} highlighted={f.highlight?.title} /></p>
                      <p className="mt-0.5 text-ink-2"><Highlighted text={f.description} highlighted={f.highlight?.description} /></p>
                      <details className="mt-1 text-ink-2">
                        <summary className="cursor-pointer text-xs text-accent">Recommendation</summary>
                        <p className="mt-1">{f.recommendation}</p>
                      </details>
                    </td>
                    <td className={`${t.tdTop} hidden whitespace-nowrap md:table-cell`}>
                      <Highlighted text={f.host} highlighted={f.highlight?.host} />
                      {f.port !== 443 && <span className="text-ink-muted">:{f.port}</span>}
                    </td>
                    <td className={`${t.tdTop} hidden whitespace-nowrap text-ink-2 sm:table-cell`}>{formatDate(f.createdAt)}</td>
                  </tr>
                ))}
                {active.data && rows.length === 0 && (
                  <tr>
                    <td className={`${t.td} py-6 text-ink-2`} colSpan={4}>
                      {searching ? `No findings match “${q}” with these filters.` : "No findings match these filters."}
                      {/* Don't leave a dead end when the matches exist but the filters hide them. */}
                      {hiddenMatches > 0 && (
                        <span className="mt-2 flex flex-wrap items-center gap-2">
                          <span>
                            {formatNumber(hiddenMatches)} {hiddenMatches === 1 ? "match is" : "matches are"} hidden by the severity or category filter.
                          </span>
                          <Button variant="secondary" onClick={showAllMatches}>Show all severities</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {meta && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
