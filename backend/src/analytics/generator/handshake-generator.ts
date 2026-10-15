import { SeededRandom } from '../../database/seed/random';
import { HandshakeLog } from '../handshake-index';

const HOUR_MS = 60 * 60 * 1000;
export const HYBRID_PQ_GROUP = 'X25519MLKEM768';

const TLS_VERSIONS = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'] as const;
type TlsVersion = (typeof TLS_VERSIONS)[number];
const rank = (v: TlsVersion) => TLS_VERSIONS.indexOf(v);

interface KeyProfile {
  algorithm: string;
  size: number | null;
}

/** A server's fixed configuration. Real servers change rarely, so each host keeps one profile. */
interface HostProfile {
  host: string;
  key: KeyProfile;
  maxTls: TlsVersion;
  supportsPqKex: boolean;
  /** Relative share of traffic (Zipf: a few hosts get most of it, like real traffic). */
  weight: number;
}

interface ClientProfile {
  userAgent: string;
  maxTls: TlsVersion;
  supportsPqKex: boolean;
}

const MODERN_CLIENTS: ClientProfile[] = [
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36', maxTls: 'TLSv1.3', supportsPqKex: true },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTls: 'TLSv1.3', supportsPqKex: true },
  { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', maxTls: 'TLSv1.3', supportsPqKex: true },
  { userAgent: 'curl/8.9.1', maxTls: 'TLSv1.3', supportsPqKex: false },
  { userAgent: 'python-requests/2.32.3', maxTls: 'TLSv1.3', supportsPqKex: false },
  { userAgent: 'okhttp/4.12.0', maxTls: 'TLSv1.3', supportsPqKex: false },
];

const LEGACY_CLIENTS: ClientProfile[] = [
  { userAgent: 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 5.1; Trident/4.0)', maxTls: 'TLSv1', supportsPqKex: false },
  { userAgent: 'Java/1.7.0_80', maxTls: 'TLSv1.1', supportsPqKex: false },
  { userAgent: 'PoS-Terminal/2.3 (embedded; OpenSSL 1.0.1)', maxTls: 'TLSv1', supportsPqKex: false },
  { userAgent: 'Apache-HttpClient/4.2.1 (java 1.6)', maxTls: 'TLSv1.1', supportsPqKex: false },
];

const SUBDOMAINS = ['www', 'api', 'auth', 'vpn', 'mail', 'portal', 'payments', 'cdn', 'admin', 'sso', 'gateway', 'app'];
const ORGS = ['northwind', 'contoso', 'fabrikam', 'initech', 'umbrella', 'globex', 'acme', 'wayne', 'stark', 'hooli'];

export interface GeneratorOptions {
  count: number;
  hostCount: number;
  /** Logs cover [end - days, end). */
  end: Date;
  days: number;
  seed: number;
}

export const DEFAULT_GENERATOR_OPTIONS: Omit<GeneratorOptions, 'end'> = {
  count: 500_000,
  hostCount: 1_500,
  days: 7,
  seed: 20261016,
};

export function createHostProfiles(random: SeededRandom, hostCount: number): HostProfile[] {
  return Array.from({ length: hostCount }, (_, i) => {
    const maxTls = random.weighted<TlsVersion>([['TLSv1.3', 60], ['TLSv1.2', 32], ['TLSv1.1', 3], ['TLSv1', 5]]);
    return {
      host: `${random.pick(SUBDOMAINS)}.${random.pick(ORGS)}-${i}.com`,
      key: random.weighted<KeyProfile>([
        [{ algorithm: 'EC', size: 256 }, 40],
        [{ algorithm: 'RSA', size: 2048 }, 38],
        [{ algorithm: 'RSA', size: 4096 }, 8],
        [{ algorithm: 'RSA', size: 1024 }, 6],
        [{ algorithm: 'EC', size: 384 }, 4],
        [{ algorithm: 'ML-DSA-65', size: null }, 3],
        [{ algorithm: 'RSA', size: 512 }, 1],
      ]),
      maxTls,
      supportsPqKex: maxTls === 'TLSv1.3' && random.chance(0.45),
      weight: 1 / Math.pow(i + 1, 0.9),
    };
  });
}

function pickCipher(random: SeededRandom, version: TlsVersion, keyAlgorithm: string): string {
  if (version === 'TLSv1.3') {
    return random.pick(['TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256']);
  }
  const auth = keyAlgorithm === 'EC' ? 'ECDSA' : 'RSA';
  if (version === 'TLSv1.2') {
    return random.weighted([
      [`ECDHE-${auth}-AES128-GCM-SHA256`, 70],
      [`ECDHE-${auth}-AES256-GCM-SHA384`, 22],
      ['AES128-SHA', 5],
      ['DES-CBC3-SHA', 3],
    ]);
  }
  return random.weighted([
    [`ECDHE-${auth}-AES256-SHA`, 70],
    ['DES-CBC3-SHA', 20],
    ['RC4-SHA', 10],
  ]);
}

function pickKexGroup(random: SeededRandom, version: TlsVersion, server: HostProfile, client: ClientProfile): string {
  if (version === 'TLSv1.3' && server.supportsPqKex && client.supportsPqKex) return HYBRID_PQ_GROUP;
  return random.weighted([['X25519', 65], ['secp256r1', 30], ['ffdhe2048', 5]]);
}

/** Daytime gets ~3x the traffic of night-time (simple sine curve over UTC hours). */
function trafficFactor(timestamp: number): number {
  const hour = new Date(timestamp).getUTCHours();
  return 0.6 + 0.4 * Math.sin(((hour - 6) / 24) * 2 * Math.PI);
}

function randomClientIp(random: SeededRandom): string {
  const prefix = random.pick(['10.20', '10.40', '172.16', '192.168', '203.0', '198.51']);
  return `${prefix}.${random.int(0, 255)}.${random.int(1, 254)}`;
}

/** Picks a host with probability proportional to its weight (cumulative weights + binary search). */
function hostPicker(random: SeededRandom, hosts: HostProfile[]): () => HostProfile {
  const cumulative: number[] = [];
  let sum = 0;
  for (const h of hosts) cumulative.push((sum += h.weight));
  return () => {
    const roll = random.next() * sum;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < roll) lo = mid + 1;
      else hi = mid;
    }
    return hosts[lo];
  };
}

/** The simulated incident: 14:00-17:00 UTC, two days before `end`. */
export function incidentWindow(end: Date): { start: number; end: number } {
  const dayMs = 24 * HOUR_MS;
  const start = Math.floor((end.getTime() - 2 * dayMs) / dayMs) * dayMs + 14 * HOUR_MS;
  return { start, end: start + 3 * HOUR_MS };
}

/**
 * Yields `count` fake handshake logs, deterministic for a given seed.
 * Includes one "incident" (see incidentWindow) where a legacy client fleet causes a spike in weak
 * handshakes, so the weak-per-hour chart has something to find.
 */
export function* generateHandshakes(options: GeneratorOptions): Generator<HandshakeLog> {
  const random = new SeededRandom(options.seed);
  const hosts = createHostProfiles(random, options.hostCount);
  const pickHost = hostPicker(random, hosts);
  const end = options.end.getTime();
  const start = end - options.days * 24 * HOUR_MS;
  const { start: incidentStart, end: incidentEnd } = incidentWindow(options.end);

  for (let produced = 0; produced < options.count; ) {
    // Rejection sampling: draw a random time, keep it with probability = traffic factor.
    const timestamp = start + random.next() * (end - start);
    if (random.next() > trafficFactor(timestamp)) continue;

    const inIncident = timestamp >= incidentStart && timestamp < incidentEnd;
    const legacyShare = inIncident ? 0.35 : 0.04;
    const client = random.chance(legacyShare) ? random.pick(LEGACY_CLIENTS) : random.pick(MODERN_CLIENTS);
    const server = pickHost();
    // Both sides pick the highest version they share.
    const version = rank(client.maxTls) < rank(server.maxTls) ? client.maxTls : server.maxTls;
    const kexGroup = pickKexGroup(random, version, server, client);

    produced++;
    yield {
      '@timestamp': new Date(timestamp).toISOString(),
      host: server.host,
      client_ip: randomClientIp(random),
      tls_version: version,
      cipher: pickCipher(random, version, server.key.algorithm),
      key_algorithm: server.key.algorithm,
      key_size: server.key.size,
      kex_group: kexGroup,
      quantum_vulnerable: kexGroup !== HYBRID_PQ_GROUP,
      user_agent: client.userAgent,
      handshake_ms: Math.round((5 + random.next() * 60 + (version === 'TLSv1.3' ? 0 : 15)) * 10) / 10,
    };
  }
}
