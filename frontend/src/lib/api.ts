// NEXT_PUBLIC_* variables are inlined into the browser bundle at build time.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export type DependencyName = "postgres" | "redis" | "elasticsearch";

export interface DependencyStatus {
  status: "up" | "down";
  latencyMs: number;
  details?: string;
  error?: string;
}

export interface ReadinessReport {
  status: "ok" | "error";
  timestamp: string;
  checks: Record<DependencyName, DependencyStatus>;
}

/**
 * The readiness endpoint returns 503 with the same report shape when a dependency is down,
 * so we parse the body for both 200 and 503 and only throw on anything else.
 */
export async function fetchReadiness(signal?: AbortSignal): Promise<ReadinessReport> {
  const res = await fetch(`${API_URL}/health/ready`, { cache: "no-store", signal });
  if (res.status !== 200 && res.status !== 503) {
    throw new Error(`Unexpected response from API: HTTP ${res.status}`);
  }
  return (await res.json()) as ReadinessReport;
}
