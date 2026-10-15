/**
 * Command-line TLS scan, no server or database needed.
 *
 *   npm run scan                              # scans the seed targets
 *   npm run scan -- github.com example.com:8443
 *   npm run scan -- --json google.com         # full JSON output
 */
import { RiskEngine } from '../risk/risk-engine';
import { SEED_TARGETS } from '../scanner/seed-targets';
import { formatTarget } from '../scanner/scan-target';
import { ScanOutcome } from '../scanner/scanner.types';
import { TlsScannerService } from '../scanner/tls-scanner.service';

const riskEngine = new RiskEngine();

function toRow(outcome: ScanOutcome): Record<string, string> {
  const target = formatTarget(outcome.target);
  if (outcome.status === 'failed') {
    return { target, status: `FAILED ${outcome.error.code}` };
  }
  const { tls, certificate: cert, trust } = outcome.result;
  const key = cert.publicKey;
  const risk = riskEngine.assess(outcome.result);
  return {
    target,
    status: 'ok',
    risk: `${risk.score} ${risk.level}`,
    protocol: tls.protocol,
    cipher: tls.cipher.name,
    key: `${key.algorithm}${key.curve ? ` ${key.curve}` : ''}${key.size ? ` ${key.size}` : ''}`,
    signature: cert.signatureAlgorithm.name,
    expires: cert.validTo.slice(0, 10),
    trust: trust.authorized ? 'trusted' : (trust.error ?? 'untrusted'),
    'pq-kex': tls.postQuantumKeyExchange === null ? '?' : tls.postQuantumKeyExchange ? 'yes' : 'no',
  };
}

function printFindings(outcomes: ScanOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.status !== 'success') continue;
    const { findings } = riskEngine.assess(outcome.result);
    if (findings.length === 0) continue;
    console.log(`\n${formatTarget(outcome.target)}`);
    for (const f of findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.title}: ${f.description}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const inputs = args.filter((a) => a !== '--json');
  const targets = inputs.length > 0 ? inputs : [...SEED_TARGETS];

  const scanner = new TlsScannerService({
    timeoutMs: 8_000,
    concurrency: 10,
    probePostQuantum: true,
    allowPrivateTargets: process.env.SCAN_ALLOW_PRIVATE_TARGETS === 'true',
  });
  const outcomes = await scanner.scanMany(targets);

  if (json) {
    const assessed = outcomes.map((o) => (o.status === 'success' ? { ...o, risk: riskEngine.assess(o.result) } : o));
    console.log(JSON.stringify(assessed, null, 2));
  } else {
    console.table(outcomes.map(toRow));
    printFindings(outcomes);
  }

  const failed = outcomes.filter((o) => o.status === 'failed').length;
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
