# Test certificates

**Test-only.** These self-signed certificates (and the one private key) exist only for unit tests.
They are not trusted anywhere and must never be used for anything else.

They were generated with OpenSSL 3.5 (needed for ML-DSA) inside `alpine:3.22`:

```bash
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -sha256 -keyout rsa2048-sha256.key -out rsa2048-sha256.crt \
  -subj "/CN=localhost/O=CryptoScope Test" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
openssl req -x509 -nodes -days 3650 -newkey rsa:1024 -sha1 -keyout /dev/null -out rsa1024-sha1.crt -subj "/CN=weak.test/O=CryptoScope Test"
openssl req -x509 -nodes -days 3650 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -sha256 -keyout /dev/null -out ec-p256-sha256.crt -subj "/CN=ec.test/O=CryptoScope Test"
openssl req -x509 -nodes -days 3650 -newkey ed25519 -keyout /dev/null -out ed25519.crt -subj "/CN=ed25519.test/O=CryptoScope Test"
openssl req -x509 -nodes -days 3650 -newkey ml-dsa-65 -keyout /dev/null -out ml-dsa-65.crt -subj "/CN=pq.test/O=CryptoScope Test"
```

| File                 | Key           | Signature               | Used to test                     |
| -------------------- | ------------- | ----------------------- | -------------------------------- |
| rsa2048-sha256       | RSA 2048      | sha256WithRSAEncryption | local TLS server, RSA parsing    |
| rsa1024-sha1         | RSA 1024      | sha1WithRSAEncryption   | weak key + SHA-1 detection       |
| ec-p256-sha256       | EC P-256      | ecdsa-with-SHA256       | EC parsing                       |
| ed25519              | Ed25519       | Ed25519                 | EdDSA parsing                    |
| ml-dsa-65            | ML-DSA-65     | ML-DSA-65               | post-quantum (FIPS 204) parsing  |
