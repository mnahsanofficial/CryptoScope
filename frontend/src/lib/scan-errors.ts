/** Plain-language names for the scanner's error codes (backend ScanErrorCode). */
const LABELS: Record<string, string> = {
  DNS_NOT_FOUND: "Host not found",
  CONNECTION_REFUSED: "Connection refused",
  CONNECTION_RESET: "Connection reset",
  HOST_UNREACHABLE: "Host unreachable",
  TIMEOUT: "Timed out",
  TLS_HANDSHAKE_FAILED: "TLS handshake failed",
  NO_CERTIFICATE: "No certificate",
  INVALID_TARGET: "Invalid host",
  TARGET_NOT_ALLOWED: "Address not allowed",
};

export function scanErrorLabel(code: string | null | undefined): string {
  return (code && LABELS[code]) || "Scan failed";
}
