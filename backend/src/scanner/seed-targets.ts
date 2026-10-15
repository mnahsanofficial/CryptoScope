/** Demo targets: a mix of healthy sites and badssl.com endpoints that are deliberately misconfigured. */
export const SEED_TARGETS: readonly string[] = [
  'google.com',
  'github.com',
  'expired.badssl.com',
  'self-signed.badssl.com',
  'rsa2048.badssl.com',
  'sha256.badssl.com',
  'tls-v1-0.badssl.com:1010',
];
