import { timeAgo } from "@/lib/format";
import { scanErrorLabel } from "@/lib/scan-errors";

/**
 * "5 min ago", or "5 min ago · Host not found" when that scan failed. A failed scan keeps the previous
 * risk, so without the note "Critical, scanned just now" would look like a fresh result.
 */
export function LastScan({ at, error }: { at: string | null; error: string | null }) {
  if (!error) return <>{timeAgo(at)}</>;
  return (
    <span title={`The last scan failed (${error}). The risk shown is from the last successful scan.`}>
      {timeAgo(at)}
      <span className="block text-xs font-medium text-danger">{scanErrorLabel(error)}</span>
    </span>
  );
}
