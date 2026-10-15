import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { ScanError } from './scan-error';

/**
 * SSRF protection. The scanner connects to hosts that users type in. Without checks, an attacker could
 * make it probe our own network: the database, Redis, or the cloud metadata service at 169.254.169.254
 * (which can hand out credentials).
 *
 * Rules:
 *  1. Resolve the name ourselves and reject it if ANY address is private, loopback, link-local or reserved.
 *  2. Connect to that exact IP address (with the hostname only as SNI). Otherwise an attacker's DNS server
 *     could answer "public IP" to our check and "127.0.0.1" a moment later to the connection (DNS rebinding).
 */
const BLOCKED_RANGES: Array<[string, number, 'ipv4' | 'ipv6']> = [
  ['0.0.0.0', 8, 'ipv4'], // "this network"
  ['10.0.0.0', 8, 'ipv4'], // private
  ['100.64.0.0', 10, 'ipv4'], // carrier-grade NAT
  ['127.0.0.0', 8, 'ipv4'], // loopback
  ['169.254.0.0', 16, 'ipv4'], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12, 'ipv4'], // private (Docker networks live here)
  ['192.0.0.0', 24, 'ipv4'], // IETF protocol assignments
  ['192.0.2.0', 24, 'ipv4'], // documentation
  ['192.168.0.0', 16, 'ipv4'], // private
  ['198.18.0.0', 15, 'ipv4'], // benchmarking
  ['198.51.100.0', 24, 'ipv4'], // documentation
  ['203.0.113.0', 24, 'ipv4'], // documentation
  ['224.0.0.0', 4, 'ipv4'], // multicast
  ['240.0.0.0', 4, 'ipv4'], // reserved + broadcast
  ['::', 128, 'ipv6'], // unspecified
  ['::1', 128, 'ipv6'], // loopback
  ['64:ff9b::', 96, 'ipv6'], // NAT64 (can map to private IPv4)
  ['2001:db8::', 32, 'ipv6'], // documentation
  ['fc00::', 7, 'ipv6'], // unique local (private)
  ['fe80::', 10, 'ipv6'], // link-local
  ['ff00::', 8, 'ipv6'], // multicast
];

// No rule for IPv4-mapped IPv6 (::ffff:0:0/96) on purpose: Node's BlockList already checks
// ::ffff:127.0.0.1 against the IPv4 rules, and such a rule would match EVERY IPv4 address.
const BLOCK_LIST = new BlockList();
for (const [address, prefix, type] of BLOCKED_RANGES) BLOCK_LIST.addSubnet(address, prefix, type);

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // not an IP at all: refuse
  return BLOCK_LIST.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

export class TargetPolicy {
  constructor(
    private readonly allowPrivate: boolean,
    private readonly resolve: Resolver = systemResolver,
  ) {}

  /** Returns the IP address to connect to, or throws ScanError('TARGET_NOT_ALLOWED'). */
  async resolveAllowedAddress(host: string): Promise<string> {
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await this.resolve(host);
    if (addresses.length === 0) throw new ScanError('DNS_NOT_FOUND', `${host} has no addresses`);

    if (!this.allowPrivate) {
      // Check EVERY answer: a name can return one public and one private address.
      const blocked = addresses.find((a) => isBlockedAddress(a.address));
      if (blocked) {
        throw new ScanError('TARGET_NOT_ALLOWED', `${host} resolves to ${blocked.address}, a private or reserved address`);
      }
    }
    return (addresses.find((a) => a.family === 4) ?? addresses[0]).address;
  }
}
