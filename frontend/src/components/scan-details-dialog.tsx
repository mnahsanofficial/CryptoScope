"use client";

import { ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { expiryLabel, formatDate, timeAgo } from "@/lib/format";
import { scanErrorLabel } from "@/lib/scan-errors";
import type { ScanDetail, Severity } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ErrorNote, RiskBadge, Skeleton } from "./ui/primitives";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const DAY_MS = 86_400_000;

export interface OpenScan {
  scanId: string;
  host: string;
}

/**
 * One scan in detail: risk, connection, certificate and every finding with its recommendation.
 * A native <dialog> opened with showModal() gives focus trapping, Esc to close and an inert page for free.
 */
export function ScanDetailsDialog({ scan, onClose }: { scan: OpenScan; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const detail = useApi<ScanDetail>(`/scans/${scan.scanId}`);

  // No close() in a cleanup: removing the element closes the modal, and React's dev double-run of effects would
  // otherwise fire onClose and unmount the dialog right after it opened.
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  const d = detail.data;
  const findings = [...(d?.findings ?? [])].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> element itself: close, like most modals.
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      aria-labelledby="scan-details-title"
      className="m-auto max-h-[85vh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-hairline bg-surface p-0 text-ink shadow-xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 id="scan-details-title" className="truncate text-base font-semibold">{scan.host}</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {d ? `Scanned ${timeAgo(d.scannedAt)} · ${formatDate(d.scannedAt)} · ${d.durationMs} ms` : "Loading scan…"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => ref.current?.close()}
            className="rounded p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          {detail.error && <ErrorNote message={detail.error} />}
          {!d && !detail.error && <Skeleton className="h-64" />}

          {d?.status === "failed" && (
            <section className="rounded-lg border border-hairline bg-surface-2 px-4 py-3 text-sm">
              <p className="font-medium text-danger">{scanErrorLabel(d.errorCode)}</p>
              <p className="mt-1 text-ink-2">{d.errorMessage}</p>
              <p className="mt-2 text-xs text-ink-muted">A failed scan keeps the asset&apos;s last known risk.</p>
            </section>
          )}

          {d?.status === "success" && (
            <>
              <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Fact label="Risk">
                  <RiskBadge level={d.riskLevel} /> <span className="tabular text-ink-2">{d.riskScore}</span>
                </Fact>
                <Fact label="Protocol">{d.protocol ?? "–"}</Fact>
                <Fact label="Key exchange">{d.keyExchange ?? "–"}</Fact>
                <Fact label="Post-quantum key exchange">
                  {d.postQuantumKeyExchange ? (
                    <span className="inline-flex items-center gap-1 text-good"><ShieldCheck className="h-4 w-4" aria-hidden /> Yes</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-ink-2"><ShieldAlert className="h-4 w-4" aria-hidden /> No</span>
                  )}
                </Fact>
              </section>

              {d.certificate && <CertificateFacts cert={d.certificate} cipher={d.cipher} trustError={d.trustError} scannedAt={d.scannedAt} />}

              <section>
                <h3 className="mb-2 text-sm font-semibold">
                  {findings.length} {findings.length === 1 ? "finding" : "findings"}
                </h3>
                {findings.length === 0 ? (
                  <p className="text-sm text-ink-2">No problems found.</p>
                ) : (
                  <ul className="space-y-3">
                    {findings.map((f) => (
                      <li key={f.id} className="rounded-lg border border-hairline px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium">{f.title}</p>
                          <span className="shrink-0"><RiskBadge level={f.severity} /></span>
                        </div>
                        <p className="mt-1 text-sm text-ink-2">{f.description}</p>
                        <p className="mt-2 text-sm">
                          <span className="font-medium text-ink">What to do: </span>
                          <span className="text-ink-2">{f.recommendation}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-xs text-ink-muted">{label}</p>
      <div className="mt-0.5 break-words text-sm font-medium">{children}</div>
    </div>
  );
}

function CertificateFacts({ cert, cipher, trustError, scannedAt }: {
  cert: NonNullable<ScanDetail["certificate"]>;
  cipher: string | null;
  trustError: string | null;
  scannedAt: string;
}) {
  // Relative to the scan, like the findings: this is a report of what the scan saw.
  const daysLeft = Math.floor((Date.parse(cert.validTo) - Date.parse(scannedAt)) / DAY_MS);
  const rows: Array<[string, string]> = [
    ["Key", `${cert.keyAlgorithm}${cert.keyCurve ? ` ${cert.keyCurve}` : ""}${cert.keySize ? ` ${cert.keySize}-bit` : ""}`],
    ["Signature", cert.signatureAlgorithm],
    ["Valid until", `${formatDate(cert.validTo)} (${expiryLabel(daysLeft)})`],
    ["Subject", cert.subject],
    ["Issuer", cert.selfSigned ? `${cert.issuer} (self-signed)` : cert.issuer],
    ["Cipher", cipher ?? "–"],
  ];
  if (trustError) rows.push(["Trust", trustError]);
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Certificate</h3>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="break-all text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
