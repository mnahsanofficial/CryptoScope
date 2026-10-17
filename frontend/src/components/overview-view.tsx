"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { expiryLabel, formatNumber, formatPercent } from "@/lib/format";
import { useScanEvents } from "@/lib/scan-events-context";
import { isFinished } from "@/lib/scan-events-reducer";
import type { Asset, ExpiringCertificate, KeyAlgorithmCounts, Overview, Paginated, QuantumShare, WeakPerInterval } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useThrottled } from "@/lib/use-throttled";
import { KeyAlgorithmChart, WeakHandshakesChart } from "./charts";
import { LastScan } from "./ui/last-scan";
import { Button, Card, ErrorNote, RiskBadge, Skeleton, StatTile, tableClasses as t } from "./ui/primitives";

export function OverviewView() {
  const { isAdmin } = useAuth();
  const { finishedCount, jobs } = useScanEvents();
  const overview = useApi<Overview>("/dashboard/overview");
  const riskiest = useApi<Paginated<Asset>>("/assets?sort=riskScore&order=desc&pageSize=8");
  const expiring = useApi<Paginated<ExpiringCertificate>>("/certificates/expiring?pageSize=8");
  const algorithms = useApi<KeyAlgorithmCounts>("/analytics/handshakes/key-algorithms");
  const weak = useApi<WeakPerInterval>("/analytics/handshakes/weak-per-interval?interval=1h");
  const traffic = useApi<QuantumShare>("/analytics/handshakes/quantum-vulnerable");
  const [scanError, setScanError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Scans finished somewhere: refresh the numbers that scans change. Throttled to one reload per second,
  // so 8 scans finishing together trigger one reload instead of 8 that cancel each other.
  const finished = useThrottled(finishedCount, 1000);
  const { reload: reloadOverview } = overview;
  const { reload: reloadRiskiest } = riskiest;
  const { reload: reloadExpiring } = expiring;
  useEffect(() => {
    if (finished === 0) return;
    reloadOverview();
    reloadRiskiest();
    reloadExpiring();
  }, [finished, reloadOverview, reloadRiskiest, reloadExpiring]);

  const riskiestIds = riskiest.data?.data.map((a) => a.id) ?? [];
  // While these assets are still being scanned, a second click would only queue a duplicate batch.
  const rescanning = starting || jobs.some((j) => !isFinished(j) && riskiestIds.includes(j.assetId));

  async function scanRiskiest() {
    setScanError(null);
    setStarting(true);
    try {
      await apiFetch("/scan-jobs", { method: "POST", body: { assetIds: riskiestIds } });
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
          <Button onClick={scanRiskiest} disabled={riskiestIds.length === 0 || rescanning}>
            {rescanning ? "Rescanning…" : `Rescan riskiest ${riskiestIds.length || ""}`}
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
        <Card title="Riskiest assets" actions={<Link href="/assets" className="text-sm text-accent hover:underline">All assets</Link>}>
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
                  {riskiest.data?.data.map((a) => (
                    <tr key={a.id}>
                      <td className={t.td}><span className="block max-w-[10rem] truncate sm:max-w-[16rem] lg:max-w-[9rem] xl:max-w-[13rem]" title={`${a.host}:${a.port}`}>{a.host}</span></td>
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
          subtitle={o ? `${formatNumber(o.expiredCertificates)} expired · ${formatNumber(o.certificatesExpiringIn30Days)} within 30 days` : undefined}
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
                  {expiring.data?.data.map((c) => (
                    <tr key={c.assetId}>
                      <td className={t.td}><span className="block max-w-[10rem] truncate sm:max-w-[16rem] lg:max-w-[9rem] xl:max-w-[13rem]" title={c.subject}>{c.host}</span></td>
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
    </div>
  );
}
