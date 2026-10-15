import { ScanError } from './scan-error';
import { formatTarget, parseTarget } from './scan-target';

describe('parseTarget', () => {
  it.each([
    ['google.com', { host: 'google.com', port: 443 }],
    ['tls-v1-0.badssl.com:1010', { host: 'tls-v1-0.badssl.com', port: 1010 }],
    ['  GitHub.COM  ', { host: 'github.com', port: 443 }],
    ['https://example.com/some/path', { host: 'example.com', port: 443 }],
    ['127.0.0.1:8443', { host: '127.0.0.1', port: 8443 }],
  ])('parses %p', (input, expected) => {
    expect(parseTarget(input)).toEqual(expected);
  });

  it.each(['', 'not a host', 'exa_mple.com', '-bad.com', 'host:0', 'host:70000', 'host:abc', '::1'])(
    'rejects %p with INVALID_TARGET',
    (input) => {
      expect(() => parseTarget(input)).toThrow(ScanError);
      try {
        parseTarget(input);
      } catch (err) {
        expect((err as ScanError).code).toBe('INVALID_TARGET');
      }
    },
  );
});

describe('formatTarget', () => {
  it('omits the default port', () => {
    expect(formatTarget({ host: 'github.com', port: 443 })).toBe('github.com');
    expect(formatTarget({ host: 'github.com', port: 8443 })).toBe('github.com:8443');
  });
});
