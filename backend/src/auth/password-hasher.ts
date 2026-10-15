import { randomBytes, scrypt, ScryptOptions, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt (built into Node, no native dependency).
 *
 * scrypt is "memory-hard": every guess needs N * r * 128 bytes of RAM (128 MiB here), which makes
 * GPU/ASIC cracking far more expensive than with a fast hash like SHA-256.
 * Parameters follow OWASP's Password Storage Cheat Sheet: N=2^17, r=8, p=1.
 *
 * Stored format:  scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 * Keeping the parameters inside the string means we can raise them later: old hashes still verify,
 * and needsRehash() tells us to upgrade a user's hash at their next login (crypto-agility for passwords).
 */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  // maxmem must be above 128 * N * r bytes, or Node refuses the parameters.
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export class PasswordHasher {
  constructor(private readonly params: ScryptParams = DEFAULT_SCRYPT_PARAMS) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH); // unique per password: identical passwords get different hashes
    const key = await derive(password, salt, this.params);
    const { N, r, p } = this.params;
    return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) return false;
    const key = await derive(password, parsed.salt, parsed.params);
    // Constant-time comparison: the time taken doesn't reveal how many bytes matched.
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  }

  /** True if the stored hash uses weaker parameters than we use today. */
  needsRehash(stored: string): boolean {
    const parsed = parse(stored);
    return !parsed || parsed.params.N < this.params.N || parsed.params.r < this.params.r || parsed.params.p < this.params.p;
  }
}

function parse(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;
  return { params: { N, r, p }, salt: Buffer.from(parts[4], 'base64'), key: Buffer.from(parts[5], 'base64') };
}
