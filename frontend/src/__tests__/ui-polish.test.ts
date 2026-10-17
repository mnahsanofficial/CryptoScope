import { withGaps } from "@/components/charts";
import { jobStatus } from "@/components/scan-progress-panel";
import { expiryLabel, humanDays } from "@/lib/format";
import type { ScanProgress } from "@/lib/types";

describe("humanDays / expiryLabel", () => {
  it("switches to months and years for long spans", () => {
    expect(humanDays(1)).toBe("1 day");
    expect(humanDays(59)).toBe("59 days");
    expect(humanDays(75)).toBe("2 months");
    expect(humanDays(362)).toBe("11 months");
    expect(humanDays(4206)).toBe("11 years");
    expect(expiryLabel(-4206)).toBe("Expired 11 years ago");
    expect(expiryLabel(400)).toBe("in 1 year");
  });
});

describe("withGaps", () => {
  const bucket = (hour: number, total: number, weak: number) => ({ timestamp: `2026-10-16T${String(hour).padStart(2, "0")}:00:00Z`, total, weak, weakPercentage: 0 });

  it("turns hours without traffic into gaps and reports where data stops", () => {
    const { points, lastDataAt } = withGaps([bucket(0, 10, 2), bucket(1, 0, 0), bucket(2, 5, 0), bucket(3, 0, 0)]);
    expect(points.map((p) => p.weak)).toEqual([2, null, 0, null]); // a real zero stays zero
    expect(lastDataAt).toBe("2026-10-16T02:00:00Z");
  });

  it("reports nothing when the data runs to the end", () => {
    expect(withGaps([bucket(0, 0, 0), bucket(1, 3, 1)]).lastDataAt).toBeNull();
  });
});

describe("jobStatus", () => {
  const job = (stage: ScanProgress["stage"], result?: ScanProgress["result"]): ScanProgress => ({
    jobId: "j", assetId: "a", scanId: "s", batchId: null, stage, percent: 100, attempt: 2, maxAttempts: 3, result,
  });

  it("says Unreachable, not Done, when the job finished but the scan failed", () => {
    expect(jobStatus(job("completed", { status: "failed", riskScore: null, riskLevel: null, errorCode: "DNS_NOT_FOUND" }))).toEqual({ label: "Unreachable", tone: "bad" });
    expect(jobStatus(job("completed", { status: "success", riskScore: 10, riskLevel: "low", errorCode: null }))).toEqual({ label: "Done", tone: "ok" });
    expect(jobStatus(job("retrying"))).toEqual({ label: "Retrying (2/3)", tone: "ok" });
    expect(jobStatus(job("failed")).tone).toBe("bad");
  });
});
