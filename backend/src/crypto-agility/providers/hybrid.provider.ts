import { CryptoProvider, KeyPair, SignatureAlgorithm } from '../crypto-provider';

const PEM_BLOCK = /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----\n?/g;

/**
 * Hybrid ("composite") signature: one classical + one post-quantum signature over the same message.
 * Verification requires BOTH to be valid, so the result stays secure as long as EITHER algorithm is
 * unbroken: protection against quantum attacks (ML-DSA) without betting everything on a young algorithm
 * (ECDSA has decades of analysis behind it). This is the idea behind hybrid/composite certificates
 * (e.g. ISARA Catalyst, X.509 alternative-signature extensions, IETF composite ML-DSA drafts).
 *
 * Encoding (simple and explicit):
 *   keys:       the two component PEM blocks one after another
 *   signature:  [4-byte big-endian length of signature 1][signature 1][signature 2]
 */
export class HybridProvider implements CryptoProvider {
  readonly family = 'Hybrid' as const;
  readonly quantumSafe: boolean;
  readonly standard: string;

  constructor(
    readonly algorithm: SignatureAlgorithm,
    private readonly classical: CryptoProvider,
    private readonly postQuantum: CryptoProvider,
  ) {
    // Quantum-safe if at least one component is.
    this.quantumSafe = classical.quantumSafe || postQuantum.quantumSafe;
    this.standard = `Composite of ${classical.algorithm} and ${postQuantum.algorithm} (both must verify)`;
  }

  isAvailable(): boolean {
    return this.classical.isAvailable() && this.postQuantum.isAvailable();
  }

  async generateKeyPair(): Promise<KeyPair> {
    const [a, b] = await Promise.all([this.classical.generateKeyPair(), this.postQuantum.generateKeyPair()]);
    return { publicKey: a.publicKey + b.publicKey, privateKey: a.privateKey + b.privateKey };
  }

  async sign(message: Buffer, privateKeyPem: string): Promise<Buffer> {
    const [keyA, keyB] = splitPem(privateKeyPem);
    const [sigA, sigB] = await Promise.all([this.classical.sign(message, keyA), this.postQuantum.sign(message, keyB)]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(sigA.length);
    return Buffer.concat([length, sigA, sigB]);
  }

  async verify(message: Buffer, signature: Buffer, publicKeyPem: string): Promise<boolean> {
    const keys = trySplitPem(publicKeyPem);
    if (!keys || signature.length < 4) return false;
    const lengthA = signature.readUInt32BE(0);
    if (4 + lengthA >= signature.length) return false;
    const sigA = signature.subarray(4, 4 + lengthA);
    const sigB = signature.subarray(4 + lengthA);
    const [okA, okB] = await Promise.all([
      this.classical.verify(message, sigA, keys[0]),
      this.postQuantum.verify(message, sigB, keys[1]),
    ]);
    return okA && okB; // AND, never OR: otherwise an attacker only has to break the weaker one
  }
}

function trySplitPem(pem: string): [string, string] | null {
  const blocks = pem.match(PEM_BLOCK);
  return blocks?.length === 2 ? [blocks[0], blocks[1]] : null;
}

function splitPem(pem: string): [string, string] {
  const parts = trySplitPem(pem);
  if (!parts) throw new Error('A hybrid key must contain exactly two PEM blocks');
  return parts;
}
