// Shapes of the backend API responses (kept in sync by hand with the NestJS DTOs).

export type Role = "admin" | "viewer";
export type Severity = "critical" | "high" | "medium" | "low";
export type RiskLevel = Severity | "none";
export type FindingCategory = "certificate" | "protocol" | "quantum";

export interface User {
  id: string;
  email: string;
  role: Role;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Overview {
  totalAssets: number;
  scannedAssets: number;
  averageRiskScore: number | null;
  assetsByRiskLevel: Record<RiskLevel, number>;
  currentFindingsBySeverity: Record<Severity, number>;
  quantumVulnerableAssets: number;
  quantumVulnerablePercentage: number;
  certificatesExpiringIn30Days: number;
  expiredCertificates: number;
}

export interface Asset {
  id: string;
  host: string;
  port: number;
  label: string | null;
  environment: "production" | "staging" | "development";
  latestRiskScore: number | null;
  latestRiskLevel: RiskLevel | null;
  lastScannedAt: string | null;
}

export interface Finding {
  id: string;
  scanId: string;
  assetId: string;
  ruleId: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  description: string;
  recommendation: string;
  createdAt: string;
  asset: { id: string; host: string; port: number; label: string | null };
}

export interface ExpiringCertificate {
  assetId: string;
  host: string;
  port: number;
  environment: string;
  subject: string;
  issuer: string;
  keyAlgorithm: string;
  keySize: number | null;
  validTo: string;
  daysLeft: number;
}

export interface KeyAlgorithmCounts {
  total: number;
  algorithms: Array<{ keyAlgorithm: string; count: number; percentage: number }>;
}

export interface WeakPerInterval {
  interval: string;
  total: number;
  weak: number;
  weakPercentage: number;
  buckets: Array<{ timestamp: string; total: number; weak: number; weakPercentage: number }>;
}

export interface QuantumShare {
  total: number;
  quantumVulnerable: number;
  percentage: number;
}

// ---- Live scan events (Socket.IO namespace /scans) ----
export type ScanStage = "queued" | "scanning" | "saving" | "indexing" | "completed" | "retrying" | "failed";

export interface ScanProgress {
  jobId: string;
  assetId: string;
  scanId: string;
  batchId: string | null;
  stage: ScanStage;
  percent: number;
  attempt: number;
  maxAttempts: number;
  message?: string;
  result?: { status: "success" | "failed"; riskScore: number | null; riskLevel: RiskLevel | null; errorCode: string | null };
}

export interface BatchProgress {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  percent: number;
}
