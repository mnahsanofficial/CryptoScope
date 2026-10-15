import { TlsScanResult } from '../scanner/scanner.types';
import { Finding, RuleMetadata, Severity } from './risk.types';

const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRY_WARNING_DAYS = 30;
export const MIN_RSA_BITS = 2048;

/** Trust errors that have their own, more specific rule. */
const TRUST_ERRORS_WITH_OWN_RULE = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
]);

/** Public-key families broken by Shor's algorithm on a large quantum computer. */
const QUANTUM_VULNERABLE_KEYS: Record<string, string> = {
  RSA: 'integer factorisation',
  EC: 'the elliptic-curve discrete logarithm problem',
  Ed25519: 'the elliptic-curve discrete logarithm problem',
  Ed448: 'the elliptic-curve discrete logarithm problem',
};

export interface RuleContext {
  /** Injected so tests (and re-assessments of old scans) don't depend on the real clock. */
  now: Date;
}

export interface RiskRule {
  meta: RuleMetadata;
  /** Returns a finding if the rule matches, otherwise null. Must be a pure function. */
  evaluate(scan: TlsScanResult, ctx: RuleContext): Finding | null;
}

type FindingDetails = Pick<Finding, 'description' | 'recommendation' | 'evidence'> & { severity?: Severity };

function finding(meta: RuleMetadata, details: FindingDetails): Finding {
  return {
    ruleId: meta.id,
    severity: details.severity ?? meta.severity,
    category: meta.category,
    title: meta.title,
    description: details.description,
    recommendation: details.recommendation,
    evidence: details.evidence,
  };
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

const certExpired: RiskRule = {
  meta: {
    id: 'CERT_EXPIRED',
    severity: 'critical',
    category: 'certificate',
    title: 'Certificate has expired',
    rationale: 'Clients reject expired certificates, so the service is effectively down or users are trained to click through warnings.',
  },
  evaluate(scan, { now }) {
    const validTo = new Date(scan.certificate.validTo);
    if (validTo > now) return null;
    const daysAgo = daysBetween(validTo, now);
    return finding(this.meta, {
      description: `The certificate expired on ${scan.certificate.validTo.slice(0, 10)} (${daysAgo} days ago).`,
      recommendation: 'Renew the certificate now and automate renewal (e.g. ACME / Let\'s Encrypt) with expiry monitoring.',
      evidence: { validTo: scan.certificate.validTo, daysSinceExpiry: daysAgo },
    });
  },
};

const certExpiringSoon: RiskRule = {
  meta: {
    id: 'CERT_EXPIRING_SOON',
    severity: 'high',
    category: 'certificate',
    title: `Certificate expires within ${EXPIRY_WARNING_DAYS} days`,
    rationale: 'Expiry is one of the most common causes of outages; renewal needs lead time.',
  },
  evaluate(scan, { now }) {
    const validTo = new Date(scan.certificate.validTo);
    const remainingMs = validTo.getTime() - now.getTime();
    // Already expired is handled by CERT_EXPIRED, so the two rules never fire together.
    if (remainingMs <= 0 || remainingMs >= EXPIRY_WARNING_DAYS * DAY_MS) return null;
    const daysLeft = daysBetween(now, validTo);
    return finding(this.meta, {
      description: `The certificate expires on ${scan.certificate.validTo.slice(0, 10)} (in ${daysLeft} days).`,
      recommendation: 'Renew the certificate before it expires and automate renewal.',
      evidence: { validTo: scan.certificate.validTo, daysUntilExpiry: daysLeft },
    });
  },
};

const certSelfSigned: RiskRule = {
  meta: {
    id: 'CERT_SELF_SIGNED',
    severity: 'medium',
    category: 'certificate',
    title: 'Self-signed certificate',
    rationale: 'Nobody vouches for a self-signed certificate, so clients cannot tell it apart from an attacker\'s.',
  },
  evaluate(scan) {
    const selfSigned =
      scan.certificate.selfSigned ||
      scan.trust.error === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      scan.trust.error === 'SELF_SIGNED_CERT_IN_CHAIN';
    if (!selfSigned) return null;
    return finding(this.meta, {
      description: `The certificate for "${scan.certificate.subject}" is self-signed and not issued by a trusted CA.`,
      recommendation: 'Use a certificate from a public CA, or from your internal PKI with its root distributed to clients.',
      evidence: { subject: scan.certificate.subject, issuer: scan.certificate.issuer, trustError: scan.trust.error },
    });
  },
};

const certUntrustedChain: RiskRule = {
  meta: {
    id: 'CERT_UNTRUSTED_CHAIN',
    severity: 'medium',
    category: 'certificate',
    title: 'Certificate chain is not trusted',
    rationale: 'Clients will show warnings or refuse to connect; often caused by a missing intermediate certificate.',
  },
  evaluate(scan) {
    const error = scan.trust.error;
    if (scan.trust.authorized || !error || TRUST_ERRORS_WITH_OWN_RULE.has(error)) return null;
    return finding(this.meta, {
      description: `Certificate validation failed with ${error}.`,
      recommendation: 'Serve the full certificate chain (leaf + intermediates) and make sure the issuing CA is trusted.',
      evidence: { trustError: error, issuer: scan.certificate.issuer },
    });
  },
};

const weakRsaKey: RiskRule = {
  meta: {
    id: 'WEAK_RSA_KEY',
    severity: 'high',
    category: 'certificate',
    title: `RSA key shorter than ${MIN_RSA_BITS} bits`,
    rationale: 'RSA keys below 2048 bits are below NIST minimums; 512-bit keys have been factored publicly and 1024-bit is within reach of well-funded attackers.',
  },
  evaluate(scan) {
    const { algorithm, size } = scan.certificate.publicKey;
    if (algorithm !== 'RSA' || size === null || size >= MIN_RSA_BITS) return null;
    return finding(this.meta, {
      description: `The certificate uses a ${size}-bit RSA key.`,
      recommendation: 'Reissue with RSA-3072 or ECDSA P-256 now, and plan the move to ML-DSA (post-quantum).',
      evidence: { keyAlgorithm: algorithm, keySize: size },
    });
  },
};

const weakSignatureHash: RiskRule = {
  meta: {
    id: 'WEAK_SIGNATURE_HASH',
    severity: 'high',
    category: 'certificate',
    title: 'Certificate signed with a broken hash (SHA-1 / MD5)',
    rationale: 'Practical collisions exist for SHA-1 (SHAttered, 2017) and MD5 (rogue CA certificate, 2008), allowing forged certificates. MD5 is rated critical.',
  },
  evaluate(scan) {
    const { name, hash } = scan.certificate.signatureAlgorithm;
    if (hash !== 'SHA-1' && hash !== 'MD5') return null;
    return finding(this.meta, {
      severity: hash === 'MD5' ? 'critical' : 'high',
      description: `The certificate signature uses ${name}.`,
      recommendation: 'Reissue the certificate with a SHA-256 (or stronger) signature.',
      evidence: { signatureAlgorithm: name, hash },
    });
  },
};

const LEGACY_PROTOCOLS: Record<string, Severity> = { SSLv3: 'critical', TLSv1: 'high', 'TLSv1.1': 'high' };

const legacyTlsVersion: RiskRule = {
  meta: {
    id: 'LEGACY_TLS_VERSION',
    severity: 'high',
    category: 'protocol',
    title: 'Deprecated TLS/SSL protocol version',
    rationale: 'TLS 1.0 and 1.1 were deprecated by RFC 8996 (2021) and lack modern AEAD ciphers; SSLv3 (POODLE) is rated critical.',
  },
  evaluate(scan) {
    const severity = LEGACY_PROTOCOLS[scan.tls.protocol];
    if (!severity) return null;
    return finding(this.meta, {
      severity,
      description: `The server negotiated ${scan.tls.protocol} (cipher ${scan.tls.cipher.name}).`,
      recommendation: 'Disable SSLv3, TLS 1.0 and TLS 1.1. Support TLS 1.2 as a minimum and prefer TLS 1.3.',
      evidence: { protocol: scan.tls.protocol, cipher: scan.tls.cipher.name },
    });
  },
};

const quantumVulnerableKey: RiskRule = {
  meta: {
    id: 'QUANTUM_VULNERABLE_KEY',
    severity: 'medium',
    category: 'quantum',
    title: 'Quantum-vulnerable public key (RSA / ECC)',
    rationale: "Shor's algorithm on a cryptographically relevant quantum computer breaks RSA and elliptic-curve keys, which would allow certificate forgery and server impersonation.",
  },
  evaluate(scan) {
    const { algorithm, size, curve } = scan.certificate.publicKey;
    const hardProblem = QUANTUM_VULNERABLE_KEYS[algorithm];
    if (!hardProblem) return null;
    const keyLabel = [algorithm, curve, size ? `${size}-bit` : null].filter(Boolean).join(' ');
    return finding(this.meta, {
      description: `The certificate key (${keyLabel}) relies on ${hardProblem}, which Shor's algorithm solves efficiently.`,
      recommendation: 'Add this asset to the PQC migration plan: move to ML-DSA (FIPS 204) certificates, using hybrid or crypto-agile deployments during the transition.',
      evidence: { keyAlgorithm: algorithm, keySize: size, curve: curve ?? null },
    });
  },
};

const noPqKeyExchange: RiskRule = {
  meta: {
    id: 'NO_PQ_KEY_EXCHANGE',
    severity: 'medium',
    category: 'quantum',
    title: 'No post-quantum key exchange',
    rationale: '"Harvest now, decrypt later": traffic recorded today can be decrypted once quantum computers can break ECDH/RSA key exchange. Hybrid ML-KEM key exchange prevents this.',
  },
  evaluate(scan) {
    const { protocol, postQuantumKeyExchange } = scan.tls;
    // Hybrid PQ groups only exist in TLS 1.3. If the server picked an older version, it can't support them.
    const unsupported = protocol !== 'TLSv1.3' || postQuantumKeyExchange === false;
    if (!unsupported) return null; // true, or null = probe inconclusive (we don't report what we don't know)
    return finding(this.meta, {
      description:
        protocol !== 'TLSv1.3'
          ? `The server uses ${protocol}; hybrid post-quantum key exchange requires TLS 1.3.`
          : 'The server does not accept the hybrid X25519MLKEM768 key exchange group.',
      recommendation: 'Enable TLS 1.3 with the X25519MLKEM768 hybrid group (supported by OpenSSL 3.5+, BoringSSL and major CDNs).',
      evidence: { protocol, postQuantumKeyExchange, keyExchange: scan.tls.keyExchange.name },
    });
  },
};

/** Order here is only for display in GET /api/risk/rules; findings are sorted by severity. */
export const RULES: readonly RiskRule[] = [
  certExpired,
  certExpiringSoon,
  certSelfSigned,
  certUntrustedChain,
  weakRsaKey,
  weakSignatureHash,
  legacyTlsVersion,
  quantumVulnerableKey,
  noPqKeyExchange,
];
