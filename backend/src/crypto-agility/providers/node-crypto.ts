import { generateKeyPair as generateKeyPairCallback, KeyObject, sign as signCallback, verify as verifyCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { KeyPair } from '../crypto-provider';

/** Small promise wrappers around Node's crypto, shared by the providers. Async = off the event loop. */

const generate = promisify(generateKeyPairCallback) as unknown as (
  type: string,
  options: Record<string, unknown>,
) => Promise<{ publicKey: KeyObject; privateKey: KeyObject }>;

export async function generatePemKeyPair(type: string, options: Record<string, unknown> = {}): Promise<KeyPair> {
  const { publicKey, privateKey } = await generate(type, options);
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

// `null` digest = the algorithm hashes internally (EdDSA, ML-DSA). Key may be a PEM or key options object.
type SignKey = Parameters<typeof signCallback>[2];
type VerifyKey = Parameters<typeof verifyCallback>[2];

export function signAsync(digest: string | null, message: Buffer, key: SignKey): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    signCallback(digest, message, key, (err, signature) => (err ? reject(err) : resolve(signature))),
  );
}

export async function verifyAsync(digest: string | null, message: Buffer, key: VerifyKey, signature: Buffer): Promise<boolean> {
  try {
    return await new Promise<boolean>((resolve, reject) =>
      verifyCallback(digest, message, key, signature, (err, ok) => (err ? reject(err) : resolve(ok))),
    );
  } catch {
    // A malformed signature or a key of the wrong type is simply "not valid".
    return false;
  }
}
