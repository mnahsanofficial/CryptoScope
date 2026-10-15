import { isIP } from 'node:net';
import { ScanError } from './scan-error';
import { ScanTarget } from './scanner.types';

const DEFAULT_TLS_PORT = 443;
// RFC 1123 hostname: labels of letters, digits and hyphens, separated by dots.
const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Parses "example.com", "example.com:8443" or "https://example.com/path" into { host, port }.
 * Throws ScanError('INVALID_TARGET') for anything that isn't a plain hostname or IPv4 address.
 */
export function parseTarget(input: string): ScanTarget {
  const raw = input.trim().replace(/^https?:\/\//i, '').split('/')[0];
  if (!raw) {
    throw new ScanError('INVALID_TARGET', `Empty target: "${input}"`);
  }

  const [host, portText, ...rest] = raw.split(':');
  if (rest.length > 0) {
    throw new ScanError('INVALID_TARGET', `Unsupported target format: "${input}" (IPv6 is not supported yet)`);
  }

  if (!HOSTNAME_PATTERN.test(host) && isIP(host) !== 4) {
    throw new ScanError('INVALID_TARGET', `Invalid hostname: "${host}"`);
  }

  const port = portText === undefined ? DEFAULT_TLS_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ScanError('INVALID_TARGET', `Invalid port in "${input}"`);
  }

  return { host: host.toLowerCase(), port };
}

export function formatTarget({ host, port }: ScanTarget): string {
  return port === DEFAULT_TLS_PORT ? host : `${host}:${port}`;
}
