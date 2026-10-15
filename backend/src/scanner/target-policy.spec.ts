import { ScanError } from './scan-error';
import { isBlockedAddress, Resolver, TargetPolicy } from './target-policy';
import { TlsScannerService } from './tls-scanner.service';

const resolverFor =
  (answers: Record<string, string[]>): Resolver =>
  async (host) =>
    (answers[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ALLOWED';
  } catch (err) {
    return (err as ScanError).code;
  }
}

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5', // Docker network
    '192.168.1.1',
    '169.254.169.254', // cloud metadata service
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '140.82.112.3', '2606:4700:4700::1111'])('allows public %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('TargetPolicy', () => {
  const policy = new TargetPolicy(false, resolverFor({
    'github.com': ['140.82.112.3'],
    'internal.corp': ['10.0.0.7'],
    'sneaky.example': ['140.82.112.3', '127.0.0.1'], // one public, one private answer
    'metadata.attacker.test': ['169.254.169.254'],
    'v6only.example': ['2606:4700:4700::1111'],
  }));

  it('returns the address to connect to for a public host', async () => {
    await expect(policy.resolveAllowedAddress('github.com')).resolves.toBe('140.82.112.3');
    await expect(policy.resolveAllowedAddress('v6only.example')).resolves.toBe('2606:4700:4700::1111');
  });

  it.each(['internal.corp', 'sneaky.example', 'metadata.attacker.test', '127.0.0.1', '10.0.0.1'])(
    'refuses %s',
    async (host) => {
      expect(await codeOf(policy.resolveAllowedAddress(host))).toBe('TARGET_NOT_ALLOWED');
    },
  );

  it('reports a name without addresses as DNS_NOT_FOUND', async () => {
    expect(await codeOf(policy.resolveAllowedAddress('nothing.example'))).toBe('DNS_NOT_FOUND');
  });

  it('allows private targets only when explicitly enabled (dev and tests)', async () => {
    const permissive = new TargetPolicy(true, resolverFor({ 'internal.corp': ['10.0.0.7'] }));
    await expect(permissive.resolveAllowedAddress('internal.corp')).resolves.toBe('10.0.0.7');
  });
});

describe('TlsScannerService with SSRF protection on', () => {
  it('refuses to connect to a private address and never opens a socket', async () => {
    const scanner = new TlsScannerService({
      timeoutMs: 1_000,
      concurrency: 2,
      probePostQuantum: false,
      allowPrivateTargets: false,
      // DNS rebinding attempt: a public-looking name that points at the metadata service
      resolver: resolverFor({ 'innocent.example': ['169.254.169.254'] }),
    });

    const [byName, byIp] = await scanner.scanMany(['innocent.example', '127.0.0.1:5432']);

    expect(byName).toMatchObject({ status: 'failed', error: { code: 'TARGET_NOT_ALLOWED' } });
    expect(byIp).toMatchObject({ status: 'failed', error: { code: 'TARGET_NOT_ALLOWED' } });
  });
});
