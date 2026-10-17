import { Search, X } from "lucide-react";
import { Fragment, type ButtonHTMLAttributes, type ReactNode } from "react";
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
    // min-w-0: inside a grid, a wide table scrolls within the card instead of widening the whole page.
    <section className={`min-w-0 rounded-xl border border-hairline bg-surface p-4 sm:p-5 ${className}`}>
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
  if (total === 0) return null; // the empty state already says there is nothing; "Page 1 of 1" adds noise
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-2">
      <span className="tabular">
        {totalPages > 1 ? `Page ${page} of ${totalPages} · ` : ""}
        {total.toLocaleString("en-US")} total
      </span>
      {/* One page: nothing to page through, so no disabled buttons either. */}
      {totalPages > 1 && (
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export const tableClasses = {
  /** Wrap every table in this: on narrow screens the table scrolls sideways inside its card. */
  wrap: "-mx-1 overflow-x-auto px-1",
  table: "w-full border-collapse text-left text-sm",
  th: "whitespace-nowrap border-b border-hairline px-2 py-2 text-xs sm:px-3 font-medium uppercase tracking-wide text-ink-muted",
  /** Single-line cells: centered vertically, so text lines up with checkboxes and buttons in the row. */
  td: "border-b border-hairline px-2 py-2.5 align-middle sm:px-3",
  /** Multi-line cells (finding text): everything starts at the top. */
  tdTop: "border-b border-hairline px-2 py-2.5 align-top sm:px-3",
};

/** A host name that may wrap only after "." or "-" (cdn.initech-2410.ca), never in the middle of a label. */
export function HostName({ host }: { host: string }) {
  const parts = host.split(/(?<=[.-])/);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </>
  );
}

export const inputClass =
  "rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors placeholder:text-ink-muted focus:border-accent";

/** Text search box with an icon and a clear button. Used by every page that searches. */
export function SearchInput({ value, onChange, label, placeholder, className = "" }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) onChange("");
        }}
        className={`${inputClass} w-full pl-9 pr-9`}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
