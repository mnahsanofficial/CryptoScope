/**
 * Command-line TLS scan, no server or database needed.
 *
 *   npm run scan                              # scans the seed targets
 *   npm run scan -- github.com example.com:8443
 *   npm run scan -- --json google.com         # full JSON output
 */
import { SEED_TARGETS } from '../scanner/seed-targets';
import { formatTarget } from '../scanner/scan-target';
import { ScanOutcome } from '../scanner/scanner.types';
import { TlsScannerService } from '../scanner/tls-scanner.service';

function toRow(outcome: ScanOutcome): Record<string, string> {
  const target = formatTarget(outcome.target);
  if (outcome.status === 'failed') {
    return { target, status: `FAILED ${outcome.error.code}` };
  }
  const { tls, certificate: cert, trust } = outcome.result;
  const key = cert.publicKey;
  return {
    target,
    status: 'ok',
    protocol: tls.protocol,
    cipher: tls.cipher.name,
    key: `${key.algorithm}${key.curve ? ` ${key.curve}` : ''}${key.size ? ` ${key.size}` : ''}`,
    signature: cert.signatureAlgorithm.name,
    expires: cert.validTo.slice(0, 10),
    trust: trust.authorized ? 'trusted' : (trust.error ?? 'untrusted'),
    'pq-kex': tls.postQuantumKeyExchange === null ? '?' : tls.postQuantumKeyExchange ? 'yes' : 'no',
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const inputs = args.filter((a) => a !== '--json');
  const targets = inputs.length > 0 ? inputs : [...SEED_TARGETS];

  const scanner = new TlsScannerService({ timeoutMs: 8_000, concurrency: 10, probePostQuantum: true });
  const outcomes = await scanner.scanMany(targets);

  if (json) {
    console.log(JSON.stringify(outcomes, null, 2));
  } else {
    console.table(outcomes.map(toRow));
  }

  const failed = outcomes.filter((o) => o.status === 'failed').length;
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
