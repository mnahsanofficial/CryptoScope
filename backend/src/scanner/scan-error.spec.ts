import { ScanError, toScanError } from './scan-error';

function systemError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

describe('toScanError', () => {
  it.each([
    ['ENOTFOUND', 'DNS_NOT_FOUND'],
    ['ECONNREFUSED', 'CONNECTION_REFUSED'],
    ['ECONNRESET', 'CONNECTION_RESET'],
    ['EHOSTUNREACH', 'HOST_UNREACHABLE'],
    ['ETIMEDOUT', 'TIMEOUT'],
    ['ERR_SSL_UNSUPPORTED_PROTOCOL', 'TLS_HANDSHAKE_FAILED'],
  ])('maps %s to %s', (code, expected) => {
    expect(toScanError(systemError(code)).code).toBe(expected);
  });

  it('keeps an existing ScanError unchanged', () => {
    const original = new ScanError('TIMEOUT', 'too slow');
    expect(toScanError(original)).toBe(original);
  });

  it('falls back to UNKNOWN for anything else, including non-Error values', () => {
    expect(toScanError(new Error('boom')).code).toBe('UNKNOWN');
    expect(toScanError('a string').message).toBe('a string');
  });
});
