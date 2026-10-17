const numberFormat = new Intl.NumberFormat("en-US");

export const formatNumber = (n: number | null | undefined): string => (n == null ? "–" : numberFormat.format(n));

export const formatPercent = (n: number | null | undefined, digits = 1): string =>
  n == null ? "–" : `${n.toFixed(digits)}%`;

/** "2026-10-14" in the viewer's time zone. */
export const formatDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString("en-CA") : "–";

/** "3 min ago", "2 h ago", "5 d ago". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** 12 -> "12 days", 75 -> "2 months", 4206 -> "11 years": nobody can read "4206 days" at a glance. */
export function humanDays(days: number): string {
  if (days >= 365) return plural(Math.floor(days / 365), "year");
  if (days >= 60) return plural(Math.floor(days / 30.44), "month"); // average month length: 362 days is 11 months, not 12
  return plural(days, "day");
}

/** "Expired 12 days ago", "Expired 11 years ago", "Expires today", "in 9 days". */
export function expiryLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Expired ${humanDays(-daysLeft)} ago`;
  if (daysLeft === 0) return "Expires today";
  return `in ${humanDays(daysLeft)}`;
}
