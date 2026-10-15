import { ScanErrorCode } from './scanner.types';

export class ScanError extends Error {
  constructor(
    readonly code: ScanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ScanError';
  }
}

const SYSTEM_ERROR_CODES: Record<string, ScanErrorCode> = {
  ENOTFOUND: 'DNS_NOT_FOUND',
  EAI_AGAIN: 'DNS_NOT_FOUND',
  ECONNREFUSED: 'CONNECTION_REFUSED',
  ECONNRESET: 'CONNECTION_RESET',
  EPIPE: 'CONNECTION_RESET',
  EHOSTUNREACH: 'HOST_UNREACHABLE',
  ENETUNREACH: 'HOST_UNREACHABLE',
  ETIMEDOUT: 'TIMEOUT',
};

/** Turns any socket/TLS error into a ScanError with a stable code the API and UI can rely on. */
export function toScanError(err: unknown): ScanError {
  if (err instanceof ScanError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const code = (err as NodeJS.ErrnoException | undefined)?.code ?? '';

  if (code in SYSTEM_ERROR_CODES) {
    return new ScanError(SYSTEM_ERROR_CODES[code], message);
  }
  // OpenSSL errors surface as ERR_SSL_* (e.g. ERR_SSL_UNSUPPORTED_PROTOCOL, ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE).
  if (code.startsWith('ERR_SSL_') || /handshake|ssl|tls/i.test(message)) {
    return new ScanError('TLS_HANDSHAKE_FAILED', message);
  }
  return new ScanError('UNKNOWN', message);
}
