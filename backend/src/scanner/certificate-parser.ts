import { X509Certificate } from 'node:crypto';
import { EC_CURVE_BITS, PUBLIC_KEY_ALGORITHMS, SIGNATURE_ALGORITHMS } from './oids';
import { CertificateInfo, PublicKeyInfo, SignatureAlgorithmInfo } from './scanner.types';
import { readAlgorithmOids } from './x509-der';

/** Node prints DNs one attribute per line ("CN=a\nO=b"); join them the usual way. */
function formatDistinguishedName(dn: string): string {
  return dn.split('\n').filter(Boolean).join(', ');
}

/** "DNS:a.com, DNS:b.com, IP Address:1.2.3.4" -> ["a.com", "b.com", "1.2.3.4"] */
function parseSubjectAltNames(san: string | undefined): string[] {
  if (!san) return [];
  return san
    .split(', ')
    .map((entry) => entry.slice(entry.indexOf(':') + 1).trim())
    .filter(Boolean);
}

function describePublicKey(cert: X509Certificate, oid: string): PublicKeyInfo {
  const algorithm = PUBLIC_KEY_ALGORITHMS[oid] ?? 'unknown';

  // Node knows RSA/EC/EdDSA key details. For keys it can't parse (e.g. ML-DSA on Node 22) we still have the OID.
  let details: { modulusLength?: number; namedCurve?: string } = {};
  try {
    details = cert.publicKey.asymmetricKeyDetails ?? {};
  } catch {
    details = {};
  }

  switch (algorithm) {
    case 'RSA':
      return { algorithm, size: details.modulusLength ?? null, oid };
    case 'EC': {
      const curve = details.namedCurve;
      return { algorithm, size: curve ? (EC_CURVE_BITS[curve] ?? null) : null, curve, oid };
    }
    case 'Ed25519':
      return { algorithm, size: 256, oid };
    case 'Ed448':
      return { algorithm, size: 456, oid };
    default:
      return { algorithm, size: null, oid };
  }
}

function describeSignature(oid: string): SignatureAlgorithmInfo {
  const known = SIGNATURE_ALGORITHMS[oid];
  return known ? { ...known, oid } : { name: 'unknown', hash: null, oid };
}

function isSelfSigned(cert: X509Certificate): boolean {
  if (!cert.checkIssued(cert)) return false;
  try {
    return cert.verify(cert.publicKey);
  } catch {
    // Node can't load the key (e.g. ML-DSA): fall back to the subject == issuer check.
    return true;
  }
}

export function parseCertificate(der: Buffer): CertificateInfo {
  const cert = new X509Certificate(der);
  const { signatureAlgorithmOid, publicKeyAlgorithmOid } = readAlgorithmOids(der);

  return {
    subject: formatDistinguishedName(cert.subject),
    issuer: formatDistinguishedName(cert.issuer),
    subjectAltNames: parseSubjectAltNames(cert.subjectAltName),
    serialNumber: cert.serialNumber,
    validFrom: cert.validFromDate.toISOString(),
    validTo: cert.validToDate.toISOString(),
    publicKey: describePublicKey(cert, publicKeyAlgorithmOid),
    signatureAlgorithm: describeSignature(signatureAlgorithmOid),
    selfSigned: isSelfSigned(cert),
    fingerprintSha256: cert.fingerprint256,
  };
}
