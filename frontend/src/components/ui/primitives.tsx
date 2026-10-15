import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { RiskLevel } from "@/lib/types";

/** Small building blocks shared by every page. */

export function Card({ title, subtitle, actions, children, className = "" }: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-hairline bg-surface p-5 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Stat tile: label, big value, optional hint underneath. */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-5">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
    </div>
  );
}

const STATUS: Record<RiskLevel, { color: string; label: string; glyph: string }> = {
  critical: { color: "var(--status-critical)", label: "Critical", glyph: "▲" },
  high: { color: "var(--status-serious)", label: "High", glyph: "◆" },
  medium: { color: "var(--status-warning)", label: "Medium", glyph: "●" },
  low: { color: "var(--status-warning)", label: "Low", glyph: "○" },
  none: { color: "var(--status-good)", label: "None", glyph: "✓" },
};

/** Risk level / severity: colored glyph + text label, so meaning never depends on color alone. */
export function RiskBadge({ level }: { level: RiskLevel | null }) {
  if (!level) return <span className="text-sm text-ink-muted">Not scanned</span>;
  const s = STATUS[level];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
      <span aria-hidden style={{ color: s.color }} className="text-xs leading-none">
        {s.glyph}
      </span>
      {s.label}
    </span>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-accent-soft"
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${clamped}%` }} />
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-accent text-white hover:opacity-90",
    secondary: "border border-hairline bg-surface text-ink hover:bg-surface-2",
    ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

export function Pagination({ page, totalPages, total, onPage }: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-2">
      <span className="tabular">
        Page {page} of {Math.max(totalPages, 1)} · {total.toLocaleString("en-US")} total
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export const tableClasses = {
  table: "w-full border-collapse text-left text-sm",
  th: "border-b border-hairline px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted",
  td: "border-b border-hairline px-3 py-2.5 align-top",
};
