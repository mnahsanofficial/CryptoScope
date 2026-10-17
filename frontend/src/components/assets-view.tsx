"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, queryString } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { timeAgo } from "@/lib/format";
import { useScanEvents } from "@/lib/scan-events-context";
import { isFinished } from "@/lib/scan-events-reducer";
import { useDebounced } from "@/lib/use-debounced";
import type { Asset, Paginated, RiskLevel } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Button, Card, ErrorNote, HostName, inputClass, Pagination, RiskBadge, SearchInput, Skeleton, tableClasses as t } from "./ui/primitives";

const RISK_LEVELS: RiskLevel[] = ["critical", "high", "medium", "low", "none"];

export function AssetsView() {
  const { isAdmin } = useAuth();
  const { finishedCount, jobs } = useScanEvents();
  const [search, setSearch] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [environment, setEnvironment] = useState("");
  const [sort, setSort] = useState("riskScore");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search);
  const pending = search !== debouncedSearch; // typed, not searched yet: dim the old rows

  /** Changing a filter always starts again at page 1. */
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };

  const path = `/assets${queryString({ search: debouncedSearch, riskLevel, environment, sort, order: sort === "host" ? "asc" : "desc", page, pageSize: 20 })}`;
  const assets = useApi<Paginated<Asset>>(path);
  const { reload } = assets;
  useEffect(() => {
    if (finishedCount > 0) reload();
  }, [finishedCount, reload]);

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Request failed");
    }
  }

  const scanSelected = () =>
    run(async () => {
      await apiFetch("/scan-jobs", { method: "POST", body: { assetIds: [...selected] } });
      setSelected(new Set());
    });
  const scanOne = (id: string) => run(() => apiFetch(`/assets/${id}/scans`, { method: "POST" }));
  /** Assets with a scan queued or running: their Scan button shows that instead of inviting a second click. */
  const scanning = new Set(jobs.filter((j) => !isFinished(j)).map((j) => j.assetId));

  const rows = assets.data?.data ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((a) => selected.has(a.id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((current) => {
      const next = new Set(current);
      rows.forEach((a) => (allOnPageSelected ? next.delete(a.id) : next.add(a.id)));
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="text-sm text-ink-2">TLS endpoints in the inventory, with the risk of their latest scan.</p>
        </div>
        {isAdmin && (
          <Button onClick={scanSelected} disabled={selected.size === 0} title={selected.size === 0 ? "Tick assets in the table first" : undefined}>
            {selected.size > 0 ? `Scan ${selected.size} selected` : "Scan selected"}
          </Button>
        )}
      </div>

      {isAdmin && <AddAssetForm onAdded={reload} onError={setActionError} />}
      {actionError && <ErrorNote message={actionError} />}

      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <SearchInput label="Search hosts" placeholder="Search host or URL…" value={search} onChange={filter(setSearch)} className="min-w-56 flex-1" />
          <select aria-label="Risk level" value={riskLevel} onChange={(e) => filter(setRiskLevel)(e.target.value)} className={`${inputClass} flex-1 sm:flex-none`}>
            <option value="">All risk levels</option>
            {RISK_LEVELS.map((l) => (
              <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>
            ))}
          </select>
          <select aria-label="Environment" value={environment} onChange={(e) => filter(setEnvironment)(e.target.value)} className={`${inputClass} flex-1 sm:flex-none`}>
            <option value="">All environments</option>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
          <select aria-label="Sort by" value={sort} onChange={(e) => filter(setSort)(e.target.value)} className={`${inputClass} flex-1 sm:flex-none`}>
            <option value="riskScore">Highest risk first</option>
            <option value="lastScannedAt">Recently scanned</option>
            <option value="host">Host A–Z</option>
          </select>
        </div>

        {assets.error && <ErrorNote message={assets.error} />}
        {!assets.data && !assets.error ? (
          <Skeleton className="h-96" />
        ) : (
          <div className={t.wrap}>
            <table className={t.table}>
              <thead>
                <tr>
                  {isAdmin && (
                    <th className={`${t.th} w-8`}>
                      <input type="checkbox" aria-label="Select all on this page" checked={allOnPageSelected} onChange={togglePage} />
                    </th>
                  )}
                  <th className={t.th}>Host</th>
                  <th className={`${t.th} hidden md:table-cell`}>Environment</th>
                  <th className={t.th}>Risk</th>
                  <th className={`${t.th} text-right`}>Score</th>
                  <th className={`${t.th} hidden sm:table-cell`}>Last scan</th>
                  {/* Phones scan through the checkboxes + "Scan selected", which leaves the host column room to breathe. */}
                  {isAdmin && <th className={`${t.th} hidden sm:table-cell`}><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className={`transition-opacity ${assets.loading || pending ? "opacity-50" : ""}`}>
                {rows.map((a) => (
                  <tr key={a.id}>
                    {isAdmin && (
                      <td className={t.td}>
                        <input type="checkbox" aria-label={`Select ${a.host}`} checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                      </td>
                    )}
                    <td className={t.td}>
                      <span className="font-medium"><HostName host={a.host} /></span>
                      {a.port !== 443 && <span className="text-ink-muted">:{a.port}</span>}
                      {a.label && <span className="block text-xs text-ink-muted">{a.label}</span>}
                      {/* Columns hidden on small screens move under the host. */}
                      <span className="block text-xs text-ink-muted md:hidden">
                        {a.environment}
                        <span className="sm:hidden"> · {timeAgo(a.lastScannedAt)}</span>
                      </span>
                    </td>
                    <td className={`${t.td} hidden capitalize text-ink-2 md:table-cell`}>{a.environment}</td>
                    <td className={`${t.td} whitespace-nowrap`}><RiskBadge level={a.latestRiskLevel} /></td>
                    <td className={`${t.td} tabular text-right`}>{a.latestRiskScore ?? "–"}</td>
                    <td className={`${t.td} hidden whitespace-nowrap text-ink-2 sm:table-cell`}>{timeAgo(a.lastScannedAt)}</td>
                    {isAdmin && (
                      <td className={`${t.td} hidden text-right sm:table-cell`}>
                        <Button variant="ghost" className="whitespace-nowrap" onClick={() => scanOne(a.id)} disabled={scanning.has(a.id)}>
                          {scanning.has(a.id) ? "Scanning…" : "Scan"}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className={`${t.td} text-ink-2`} colSpan={7}>No assets match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {assets.data && (
          <Pagination page={assets.data.meta.page} totalPages={assets.data.meta.totalPages} total={assets.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}

function AddAssetForm({ onAdded, onError }: { onAdded: () => void; onError: (message: string | null) => void }) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("443");
  const [environment, setEnvironment] = useState("production");
  const [scanNow, setScanNow] = useState(true);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    onError(null);
    try {
      // With scanNow the API queues the first scan; its progress shows up in the live scan panel.
      await apiFetch("/assets", { method: "POST", body: { host, port: Number(port), environment, scanNow } });
      setHost("");
      onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add asset");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-hairline bg-surface p-4 sm:p-5">
      <h2 className="text-base font-semibold">Add an asset</h2>
      <p className="mb-3 mt-0.5 text-sm text-ink-2">A host name or URL. It is scanned right away unless you untick the box.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm sm:flex-none">
          <span className="text-ink-2">Host</span>
          <input required value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" className={`${inputClass} sm:w-64`} />
        </label>
        <label className="flex w-24 flex-col gap-1 text-sm">
          <span className="text-ink-2">Port</span>
          <input required type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">Environment</span>
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className={inputClass}>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
        </label>
        {/* h-[38px]: same height as the inputs, so the checkbox lines up with their text */}
        <label className="flex h-[38px] items-center gap-2 px-1 text-sm text-ink-2">
          <input type="checkbox" checked={scanNow} onChange={(e) => setScanNow(e.target.checked)} />
          Scan right away
        </label>
        <Button type="submit" disabled={saving || !host}>
          {saving ? "Adding…" : "Add asset"}
        </Button>
      </div>
    </form>
  );
}
