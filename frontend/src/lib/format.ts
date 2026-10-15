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

/** "Expired 12 days ago", "Expires today", "in 9 days". */
export function expiryLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Expired ${-daysLeft} ${-daysLeft === 1 ? "day" : "days"} ago`;
  if (daysLeft === 0) return "Expires today";
  return `in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
}
