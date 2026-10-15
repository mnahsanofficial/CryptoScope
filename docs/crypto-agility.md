# Crypto-agility: swapping signature algorithms without changing code

**Crypto-agility** is the ability to replace a cryptographic algorithm quickly and safely: because one gets
broken (SHA-1, RSA-1024), because a standard changes, or, the big one now, because quantum computers will break
RSA and elliptic-curve cryptography. NIST plans to deprecate RSA/ECC around 2030 and disallow them by 2035
(NIST IR 8547). Organisations that hard-coded `RSA` in hundreds of places face a rewrite; agile ones change
configuration.

This module shows the pattern on digital signatures.

```
            SigningService   ◀── the only thing application code uses
           ┌──────┴───────────────────────┐
  sign():  │ ACTIVE provider (from config) │   verify(): provider named IN the signature
           └──────┬───────────────────────┘
                  ▼
          CryptoProviderRegistry  (algorithm id → provider)
   ┌───────────────┬──────────────┬────────────┬───────────────────────────────┐
   RsaProvider     EcdsaProvider  MlDsaProvider HybridProvider(ECDSA + ML-DSA)
   RSA-PSS-3072    P-256          FIPS 204      both must verify
```

## The pieces

| File | Role |
| --- | --- |
| [`crypto-provider.ts`](../backend/src/crypto-agility/crypto-provider.ts) | The `CryptoProvider` interface: `generateKeyPair`, `sign`, `verify`, plus metadata (`quantumSafe`, `standard`, `isAvailable`) |
| [`classical.providers.ts`](../backend/src/crypto-agility/providers/classical.providers.ts) | `RsaProvider` (RSA-PSS, 3072-bit, SHA-256) and `EcdsaProvider` (P-256, SHA-256), using `node:crypto` |
| [`ml-dsa.provider.ts`](../backend/src/crypto-agility/providers/ml-dsa.provider.ts) | `MlDsaProvider`: ML-DSA-65 through `node:crypto` (Node.js 24+), detects support at runtime |
| [`hybrid.provider.ts`](../backend/src/crypto-agility/providers/hybrid.provider.ts) | `HybridProvider`: classical + post-quantum signature, both required |
| [`crypto-provider.registry.ts`](../backend/src/crypto-agility/crypto-provider.registry.ts) | Maps algorithm ids to providers; validates the configured one at startup |
| [`signing.service.ts`](../backend/src/crypto-agility/signing.service.ts) | Signs with the active provider, verifies with the one named in the signature, manages keys |

## Choosing the algorithm by configuration

```bash
CRYPTO_SIGNATURE_ALGORITHM=ECDSA-P256-SHA256            # default
CRYPTO_SIGNATURE_ALGORITHM=ML-DSA-65                    # post-quantum
CRYPTO_SIGNATURE_ALGORITHM=HYBRID-ECDSA-P256+ML-DSA-65  # transition: classical AND post-quantum
```

The NestJS module resolves this once (`ACTIVE_CRYPTO_PROVIDER` factory) and injects the provider. No caller
names an algorithm. A typo or an algorithm the runtime can't run **stops the app at startup** instead of failing
on the first request.

Verified in Docker: with an ECDSA signature made first, restarting with `CRYPTO_SIGNATURE_ALGORITHM=ML-DSA-65`
made new signatures ML-DSA-65 (3,309 bytes), **and the old ECDSA signature still verified**.

## Why signatures carry their algorithm

Every signature is returned as an envelope:

```json
{ "algorithm": "ML-DSA-65", "keyId": "3f2a9c...", "signature": "base64...", "publicKey": "-----BEGIN PUBLIC KEY-----..." }
```

Verification uses the provider named **in the envelope**, not the currently active one. That is what makes a
migration possible: during a transition, old ECDSA signatures and new ML-DSA signatures are both valid. It's the
same idea as the algorithm OIDs inside X.509 certificates. Never infer the algorithm from context, and never let
an attacker choose a weaker one: the server only accepts identifiers from its own registry (validated in the DTO).

## How ML-DSA plugs in

ML-DSA (FIPS 204, formerly CRYSTALS-Dilithium) is NIST's primary post-quantum signature standard. It is built
on lattice problems (Module-LWE/SIS) that Shor's algorithm doesn't solve. Plugging it in took **one class and
one line in the registry**:

1. Implement `CryptoProvider`: same three methods; Node's key type is `ml-dsa-65`, and the digest is `null`
   because ML-DSA hashes internally.
2. Register it.
3. Set `CRYPTO_SIGNATURE_ALGORITHM=ML-DSA-65`.

**Runtime support.** Node.js exposes ML-DSA from version 24 (OpenSSL 3.5). The provider tests for support once,
by generating a key. On Node 22 it reports `available: false` and answers **501 Not Implemented** with the reason,
instead of crashing. The backend Docker image therefore uses **Node.js 24**, where it works for real; local tests
run the ML-DSA contract tests automatically when the runtime supports them. Other routes to ML-DSA on older
stacks: liboqs/oqs-provider, a cloud KMS or HSM with PQC support, or a vetted library like `@noble/post-quantum`.
Each would be just another implementation of the same interface.

## The cost of post-quantum signatures (measured in Docker, Node 24)

| Algorithm | Quantum-safe | Public key | Signature | Sign | Verify |
| --- | --- | --- | --- | --- | --- |
| RSA-PSS-3072-SHA256 | no | 422 B | 384 B | ~1.4 ms | ~0.1 ms |
| ECDSA-P256-SHA256 | no | 91 B | 71 B | ~1.9 ms | ~1.4 ms |
| **ML-DSA-65** | **yes** | **1,980 B** | **3,309 B** | ~2.7 ms | ~0.6 ms |
| Hybrid ECDSA + ML-DSA-65 | yes | 2,071 B | 3,384 B | ~3.0 ms | ~0.4 ms |

`GET /api/crypto/providers` returns these numbers live (rough averages of 5 runs, measured once per process).

ML-DSA is fast; the real cost is **size**: signatures are ~46x larger than ECDSA. That matters for TLS handshakes
(certificate chains carry several signatures), constrained devices, blockchains, and databases storing millions
of signatures. Inventorying where signatures live and how big they may get is part of migration planning.

## Hybrid signatures

`HYBRID-ECDSA-P256+ML-DSA-65` signs with both algorithms and **requires both to verify** (AND, never OR).
It stays secure if *either* algorithm holds:

- **ML-DSA** protects against a future quantum computer.
- **ECDSA** protects against an undiscovered flaw in the much younger ML-DSA.

This "belt and braces" approach is how many organisations transition, and it's the idea behind hybrid and
composite certificates (e.g. ISARA's Catalyst hybrid certificates, X.509 alternative-signature extensions,
IETF composite ML-DSA drafts) that keep old clients working while new clients also check the post-quantum signature.

## What a production version needs

- **Key management:** private keys in a KMS/HSM, never in process memory; persistent public keys; rotation
  (the `keyId` exists for this). Here keys are generated per process and lost on restart, so old signatures
  must then be verified with the `publicKey` from their envelope.
- **Policy:** which algorithms are still *accepted* for verification, and until when, should be configuration
  too (e.g. stop accepting RSA-PSS after a cut-off date).
- **The same pattern for key exchange and encryption** (ML-KEM, FIPS 203): Step 2 already detects hybrid
  `X25519MLKEM768` TLS key exchange.

## API

| Method | Path | Who | Description |
| --- | --- | --- | --- |
| GET | `/api/crypto/providers` | any user | All algorithms: family, quantum-safe, available, active, sizes and timings |
| POST | `/api/crypto/sign` | admin | `{ message, algorithm? }` → signed envelope (uses the active algorithm unless overridden) |
| POST | `/api/crypto/verify` | admin, viewer | `{ message, algorithm, signature, keyId \| publicKey }` → `{ valid, algorithm, quantumSafe }` |
