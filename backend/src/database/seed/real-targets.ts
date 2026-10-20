/**
 * Real, publicly reachable TLS endpoints for `npm run seed:real`. Every one was scanned successfully when this
 * list was made (Oct 2026), so the inventory has real results next to the synthetic seed data.
 *
 * A scan is just a TLS handshake, the same as a browser opening the home page. badssl.com is a public test site
 * built to be scanned: each of its subdomains is broken in one specific way.
 */
export interface RealTarget {
  /** host or host:port, as typed in the "Add an asset" form. */
  target: string;
  label: string;
}

const group = (label: string, targets: string[]): RealTarget[] => targets.map((target) => ({ target, label }));

export const REAL_TARGETS: readonly RealTarget[] = [
  // badssl.com test servers: deliberately misconfigured (expired, self-signed, weak keys, old TLS)
  ...group('badssl.com test server', [
    'expired.badssl.com', 'wrong.host.badssl.com', 'self-signed.badssl.com', 'untrusted-root.badssl.com',
    'revoked.badssl.com', 'pinning-test.badssl.com', 'no-common-name.badssl.com', 'incomplete-chain.badssl.com',
    'sha256.badssl.com', 'sha384.badssl.com', 'sha512.badssl.com', '1000-sans.badssl.com', 'ecc256.badssl.com',
    'ecc384.badssl.com', 'rsa2048.badssl.com', 'rsa4096.badssl.com', 'rsa8192.badssl.com',
    'extended-validation.badssl.com', 'cbc.badssl.com', 'mozilla-old.badssl.com',
    'mozilla-intermediate.badssl.com', 'mozilla-modern.badssl.com', 'dh1024.badssl.com', 'dh2048.badssl.com',
    'static-rsa.badssl.com', 'tls-v1-0.badssl.com:1010', 'tls-v1-1.badssl.com:1011', 'tls-v1-2.badssl.com:1012',
    'hsts.badssl.com', 'superfish.badssl.com', 'edellroot.badssl.com', 'dsdtestprovider.badssl.com',
    'mitm-software.badssl.com', 'sha1-intermediate.badssl.com', 'badssl.com',
  ]),
  // Security, PKI and standards bodies
  ...group('Security / PKI', [
    'nist.gov', 'csrc.nist.gov', 'cisa.gov', 'isara.com', 'www.isara.com', 'entrust.com', 'digicert.com',
    'letsencrypt.org', 'sectigo.com', 'globalsign.com', 'openssl.org', 'ietf.org', 'w3.org',
  ]),
  // Cloud, hosting and CDN
  ...group('Cloud / CDN', [
    'cloudflare.com', 'example.com', 'aws.amazon.com', 'vercel.com', 'netlify.com', 'heroku.com',
    'digitalocean.com', 'hetzner.com', 'akamai.com', 'fastly.com',
  ]),
  // Developer tools and open source
  ...group('Developer tools', [
    'github.com', 'gitlab.com', 'bitbucket.org', 'mozilla.org', 'stackoverflow.com', 'kernel.org', 'debian.org',
    'ubuntu.com', 'python.org', 'nodejs.org', 'npmjs.com', 'docker.com', 'kubernetes.io', 'elastic.co',
    'postgresql.org', 'redis.io', 'nestjs.com', 'nextjs.org', 'react.dev', 'redhat.com', 'atlassian.com',
    'zeuz.ai', 'kpler.com',
  ]),
  // Finance and payments
  ...group('Finance', [
    'paypal.com', 'stripe.com', 'shopify.com', 'bankofamerica.com', 'chase.com', 'visa.com', 'mastercard.com',
    'bkash.com',
  ]),
  // Government and news
  ...group('Government / news', [
    'cnn.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com', 'reuters.com', 'gov.uk', 'canada.ca',
    'prothomalo.com',
  ]),
  // Popular websites and services
  ...group('Popular site', [
    'google.com', 'microsoft.com', 'apple.com', 'amazon.com', 'netflix.com', 'wikipedia.org', 'youtube.com',
    'facebook.com', 'instagram.com', 'whatsapp.com', 'linkedin.com', 'x.com', 'openai.com', 'anthropic.com',
    'zoom.us', 'slack.com', 'discord.com', 'dropbox.com', 'salesforce.com', 'oracle.com', 'ibm.com', 'intel.com',
    'nvidia.com', 'adobe.com', 'ebay.com', 'alibaba.com', 'yahoo.com', 'bing.com', 'duckduckgo.com', 'spotify.com',
    'twitch.tv', 'pinterest.com', 'medium.com', 'wordpress.com', 'imdb.com', 'booking.com', 'airbnb.com',
    'uber.com', 'samsung.com', 'sony.com', 'dell.com', 'hp.com', 'cisco.com', 'notion.so', 'figma.com',
    'canva.com', 'daraz.com.bd',
  ]),
];
