/**
 * Minimal DER reader that extracts the two algorithm identifiers Node's X509Certificate does not expose.
 *
 * X.509 structure (RFC 5280), simplified:
 *   Certificate ::= SEQUENCE {
 *     tbsCertificate      SEQUENCE {
 *       version           [0] EXPLICIT INTEGER   -- optional
 *       serialNumber      INTEGER
 *       signature         AlgorithmIdentifier
 *       issuer, validity, subject
 *       subjectPublicKeyInfo SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
 *       ...extensions
 *     }
 *     signatureAlgorithm  AlgorithmIdentifier    -- SEQUENCE { OBJECT IDENTIFIER, parameters }
 *     signatureValue      BIT STRING
 *   }
 *
 * Every DER element is Tag | Length | Value (TLV), so we can walk the tree without a full ASN.1 library.
 */

const TAG_SEQUENCE = 0x30;
const TAG_OID = 0x06;
const TAG_VERSION = 0xa0; // context-specific [0], constructed

interface DerElement {
  tag: number;
  contentStart: number;
  contentEnd: number;
}

function readElement(buf: Buffer, offset: number): DerElement {
  if (offset + 2 > buf.length) throw new Error('Malformed DER: truncated header');

  const tag = buf[offset];
  let length = buf[offset + 1];
  let headerLength = 2;

  // Long form: low 7 bits say how many following bytes hold the length.
  if (length & 0x80) {
    const lengthBytes = length & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4) throw new Error('Malformed DER: unsupported length');
    if (offset + 2 + lengthBytes > buf.length) throw new Error('Malformed DER: truncated length');
    length = 0;
    for (let i = 0; i < lengthBytes; i++) {
      length = length * 256 + buf[offset + 2 + i];
    }
    headerLength += lengthBytes;
  }

  const contentStart = offset + headerLength;
  const contentEnd = contentStart + length;
  if (contentEnd > buf.length) throw new Error('Malformed DER: length exceeds buffer');
  return { tag, contentStart, contentEnd };
}

function children(buf: Buffer, parent: DerElement): DerElement[] {
  const result: DerElement[] = [];
  let offset = parent.contentStart;
  while (offset < parent.contentEnd) {
    const child = readElement(buf, offset);
    result.push(child);
    offset = child.contentEnd;
  }
  return result;
}

/** OIDs are encoded as base-128 numbers; the first byte packs the first two arcs as 40*X + Y. */
function decodeOid(buf: Buffer, el: DerElement): string {
  if (el.tag !== TAG_OID) throw new Error('Malformed DER: expected OBJECT IDENTIFIER');

  const bytes = buf.subarray(el.contentStart, el.contentEnd);
  const first = bytes[0];
  const rootArc = first < 80 ? Math.floor(first / 40) : 2; // root arc is only ever 0, 1 or 2
  const arcs = [rootArc, first - rootArc * 40];

  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      arcs.push(value);
      value = 0;
    }
  }
  return arcs.join('.');
}

function algorithmOid(buf: Buffer, algorithmIdentifier: DerElement): string {
  if (algorithmIdentifier.tag !== TAG_SEQUENCE) throw new Error('Malformed DER: expected AlgorithmIdentifier');
  const [oid] = children(buf, algorithmIdentifier);
  return decodeOid(buf, oid);
}

export interface CertificateAlgorithmOids {
  signatureAlgorithmOid: string;
  publicKeyAlgorithmOid: string;
}

export function readAlgorithmOids(der: Buffer): CertificateAlgorithmOids {
  const certificate = readElement(der, 0);
  if (certificate.tag !== TAG_SEQUENCE) throw new Error('Malformed DER: certificate is not a SEQUENCE');

  const [tbsCertificate, signatureAlgorithm] = children(der, certificate);
  if (!tbsCertificate || !signatureAlgorithm) throw new Error('Malformed DER: missing certificate fields');

  const tbsFields = children(der, tbsCertificate);
  const skipVersion = tbsFields[0]?.tag === TAG_VERSION ? 1 : 0;
  // After optional version: serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo
  const subjectPublicKeyInfo = tbsFields[skipVersion + 5];
  if (!subjectPublicKeyInfo) throw new Error('Malformed DER: missing subjectPublicKeyInfo');

  const [publicKeyAlgorithm] = children(der, subjectPublicKeyInfo);

  return {
    signatureAlgorithmOid: algorithmOid(der, signatureAlgorithm),
    publicKeyAlgorithmOid: algorithmOid(der, publicKeyAlgorithm),
  };
}
