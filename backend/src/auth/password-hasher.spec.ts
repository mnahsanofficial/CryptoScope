import { DEFAULT_SCRYPT_PARAMS, PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  // Lower cost in tests so they stay fast; the algorithm is the same.
  const hasher = new PasswordHasher({ N: 2 ** 10, r: 8, p: 1 });

  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hasher.hash('correct horse battery staple');

    expect(await hasher.verify('correct horse battery staple', stored)).toBe(true);
    expect(await hasher.verify('correct horse battery stapl', stored)).toBe(false);
  });

  it('stores the algorithm and parameters with a random salt', async () => {
    const a = await hasher.hash('same password');
    const b = await hasher.hash('same password');

    expect(a).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/);
    expect(a).not.toBe(b); // different salts -> different hashes, so equal passwords aren't visible
  });

  it('never contains the password itself', async () => {
    expect(await hasher.hash('hunter2-hunter2')).not.toContain('hunter2');
  });

  it('treats Unicode-equivalent passwords as equal (NFKC normalisation)', async () => {
    const stored = await hasher.hash('café'); // é as one code point
    expect(await hasher.verify('café', stored)).toBe(true); // e + combining accent
  });

  it('rejects malformed hashes instead of throwing', async () => {
    for (const bad of ['', 'plaintext', 'bcrypt$2b$10$abc', 'scrypt$x$8$1$aa$bb']) {
      expect(await hasher.verify('anything', bad)).toBe(false);
    }
  });

  it('flags hashes made with weaker parameters for an upgrade', async () => {
    const old = await hasher.hash('pw');
    expect(new PasswordHasher(DEFAULT_SCRYPT_PARAMS).needsRehash(old)).toBe(true);
    expect(hasher.needsRehash(old)).toBe(false);
  });

  it('uses OWASP-recommended production parameters by default', () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ N: 131072, r: 8, p: 1 });
  });
});
