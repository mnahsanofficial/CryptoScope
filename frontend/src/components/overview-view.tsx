"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { expiryLabel, formatNumber, formatPercent } from "@/lib/format";
import { useScanEvents } from "@/lib/scan-events-context";
import { isFinished } from "@/lib/scan-events-reducer";
import type { Asset, ExpiringCertificate, KeyAlgorithmCounts, Overview, Paginated, QuantumShare, WeakPerInterval } from "@/lib/types";
import { realFirst } from "@/lib/real-first";
import { useApi } from "@/lib/use-api";
import { useThrottled } from "@/lib/use-throttled";
import { KeyAlgorithmChart, WeakHandshakesChart } from "./charts";
import { ScanDetailsDialog, type OpenScan } from "./scan-details-dialog";
import { LastScan } from "./ui/last-scan";
import { Button, Card, DemoTag, ErrorNote, RiskBadge, Skeleton, StatTile, tableClasses as t } from "./ui/primitives";

export function OverviewView() {
  const { isAdmin } = useAuth();
  const { finishedCount, jobs } = useScanEvents();
  const overview = useApi<Overview>("/dashboard/overview");
  // Real hosts come first everywhere on this page; seeded demo hosts (made-up domains) only fill the gaps.
  // The riskiest REAL assets with a known risk are also what "Rescan" targets: demo hosts would all fail, and
  // assets never scanned successfully have no risk to rank by.
  const rescanTargets = useApi<Paginated<Asset>>(
    "/assets?synthetic=false&riskLevel=critical,high,medium,low,none&sort=riskScore&order=desc&pageSize=8",
  );
  const riskiestDemo = useApi<Paginated<Asset>>("/assets?synthetic=true&sort=riskScore&order=desc&pageSize=8");
  const expiringReal = useApi<Paginated<ExpiringCertificate>>("/certificates/expiring?synthetic=false&pageSize=8");
  const expiringDemo = useApi<Paginated<ExpiringCertificate>>("/certificates/expiring?synthetic=true&pageSize=8");
  const [openScan, setOpenScan] = useState<OpenScan | null>(null);
  const algorithms = useApi<KeyAlgorithmCounts>("/analytics/handshakes/key-algorithms");
  const weak = useApi<WeakPerInterval>("/analytics/handshakes/weak-per-interval?interval=1h");
  const traffic = useApi<QuantumShare>("/analytics/handshakes/quantum-vulnerable");
  const [scanError, setScanError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Scans finished somewhere: refresh the numbers that scans change. Throttled to one reload per second,
  // so 8 scans finishing together trigger one reload instead of 8 that cancel each other.
  const finished = useThrottled(finishedCount, 1000);
  const { reload: reloadOverview } = overview;
  const { reload: reloadTargets } = rescanTargets;
  const { reload: reloadExpiringReal } = expiringReal;
  useEffect(() => {
    if (finished === 0) return;
    // Demo hosts can't be scanned, so only the real lists can change.
    reloadOverview();
    reloadTargets();
    reloadExpiringReal();
  }, [finished, reloadOverview, reloadTargets, reloadExpiringReal]);

  const riskiest = realFirst(rescanTargets, riskiestDemo);
  const expiring = realFirst(expiringReal, expiringDemo);

  const targetIds = rescanTargets.data?.data.map((a) => a.id) ?? [];
  // While these assets are still being scanned, a second click would only queue a duplicate batch.
  const rescanning = starting || jobs.some((j) => !isFinished(j) && targetIds.includes(j.assetId));

  async function scanRiskiest() {
    setScanError(null);
    setStarting(true);
    try {
      await apiFetch("/scan-jobs", { method: "POST", body: { assetIds: targetIds } });
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Could not start scans");
    } finally {
      setStarting(false);
    }
  }

  const o = overview.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-ink-2">Current state: each asset&apos;s latest scan, plus the last 7 days of TLS traffic.</p>
        </div>
        {isAdmin && (
          <Button
            onClick={scanRiskiest}
            disabled={targetIds.length === 0 || rescanning}
            title={`Rescans the ${targetIds.length} riskiest real assets. Seeded demo hosts are skipped: their domains don't exist.`}
          >
            {rescanning ? "Rescanning…" : `Rescan real assets (${targetIds.length})`}
          </Button>
        )}
      </div>
      {scanError && <ErrorNote message={scanError} />}
      {overview.error && <ErrorNote message={overview.error} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {o ? (
          <>
            <StatTile label="Total assets" value={formatNumber(o.totalAssets)} hint={`${formatNumber(o.scannedAssets)} scanned`} />
            <StatTile label="Average risk score" value={o.averageRiskScore == null ? "–" : String(o.averageRiskScore)} hint="0 = post-quantum ready, 100 = worst" />
            <StatTile
              label="Critical findings"
              value={formatNumber(o.currentFindingsBySeverity.critical)}
              hint={`${formatNumber(o.currentFindingsBySeverity.high)} high · ${formatNumber(o.expiredCertificates)} expired certs`}
            />
            <StatTile
              label="Quantum-vulnerable assets"
              value={formatPercent(o.quantumVulnerablePercentage)}
              hint={traffic.data ? `${formatPercent(traffic.data.percentage)} of TLS traffic` : "RSA / ECC keys"}
            />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Key algorithms in TLS traffic" subtitle="Share of handshakes per certificate key, last 7 days">
          {algorithms.error ? <ErrorNote message={algorithms.error} /> : algorithms.data ? <KeyAlgorithmChart data={algorithms.data} /> : <Skeleton className="h-36" />}
        </Card>
        <Card
          title="Weak TLS handshakes per hour"
          subtitle={weak.data ? `${formatNumber(weak.data.weak)} weak of ${formatNumber(weak.data.total)} (${formatPercent(weak.data.weakPercentage)}): TLS 1.0/1.1, RSA < 2048 or 3DES/RC4` : "Last 7 days"}
        >
          {weak.error ? <ErrorNote message={weak.error} /> : weak.data ? <WeakHandshakesChart data={weak.data} /> : <Skeleton className="h-60" />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Riskiest assets"
          subtitle="Real hosts first; click a host to see its latest scan"
          actions={<Link href="/assets" className="text-sm text-accent hover:underline">All assets</Link>}
        >
          {riskiest.error ? (
            <ErrorNote message={riskiest.error} />
          ) : !riskiest.data ? (
            <Skeleton className="h-80" />
          ) : (
            <div className={t.wrap}>
              <table className={t.table}>
                <thead>
                  <tr>
                    <th className={t.th}>Host</th>
                    <th className={t.th}>Risk</th>
                    <th className={`${t.th} text-right`}>Score</th>
                    <th className={t.th}>Last scan</th>
                  </tr>
                </thead>
                <tbody>
                  {riskiest.data.map((a) => (
                    <tr key={a.id}>
                      <td className={t.td}>
                        {/* The tag sits outside the truncated name, so a long host can't cut it off. */}
                        <span className="flex items-center">
                          {a.latestScanId ? (
                            <button
                              type="button"
                              onClick={() => setOpenScan({ scanId: a.latestScanId!, host: a.host })}
                              className="block max-w-[10rem] truncate text-left hover:text-accent hover:underline sm:max-w-[16rem] lg:max-w-[10rem] xl:max-w-[15rem]"
                              title={`${a.host}:${a.port}: show the latest scan`}
                            >
                              {a.host}
                            </button>
                          ) : (
                            <span className="block max-w-[10rem] truncate sm:max-w-[16rem] lg:max-w-[10rem] xl:max-w-[15rem]" title={`${a.host}:${a.port}`}>{a.host}</span>
                          )}
                          {a.synthetic && <DemoTag />}
                        </span>
                      </td>
                      <td className={`${t.td} whitespace-nowrap`}><RiskBadge level={a.latestRiskLevel} /></td>
                      <td className={`${t.td} tabular text-right`}>{a.latestRiskScore ?? "–"}</td>
                      <td className={`${t.td} whitespace-nowrap text-ink-2`}><LastScan at={a.lastScannedAt} error={a.lastScanError} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Certificates expiring soon"
          subtitle={
            o
              ? `Real hosts: ${formatNumber(o.real.expiredCertificates)} expired · ${formatNumber(o.real.certificatesExpiringIn30Days)} within 30 days. ` +
                `Demo data: ${formatNumber(o.expiredCertificates - o.real.expiredCertificates)} expired · ${formatNumber(o.certificatesExpiringIn30Days - o.real.certificatesExpiringIn30Days)} within 30 days.`
              : undefined
          }
        >
          {expiring.error ? (
            <ErrorNote message={expiring.error} />
          ) : !expiring.data ? (
            <Skeleton className="h-80" />
          ) : (
            <div className={t.wrap}>
              <table className={t.table}>
                <thead>
                  <tr>
                    <th className={t.th}>Host</th>
                    <th className={t.th}>Key</th>
                    <th className={t.th}>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.data.map((c) => (
                    <tr key={c.assetId}>
                      <td className={t.td}>
                        <span className="flex items-center">
                          <span className="block max-w-[10rem] truncate sm:max-w-[16rem] lg:max-w-[10rem] xl:max-w-[15rem]" title={c.subject}>{c.host}</span>
                          {c.synthetic && <DemoTag />}
                        </span>
                      </td>
                      <td className={`${t.td} whitespace-nowrap text-ink-2`}>{c.keyAlgorithm} {c.keySize ?? ""}</td>
                      <td
                        className={`${t.td} whitespace-nowrap ${c.daysLeft < 0 ? "font-medium text-danger" : "text-ink"}`}
                        title={`${Math.abs(c.daysLeft).toLocaleString("en-US")} days`}
                      >
                        {expiryLabel(c.daysLeft)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {openScan && <ScanDetailsDialog scan={openScan} onClose={() => setOpenScan(null)} />}
    </div>
  );
}
