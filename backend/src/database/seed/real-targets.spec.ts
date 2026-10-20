import { parseTarget } from '../../scanner/scan-target';
import { REAL_TARGETS } from './real-targets';

// The pattern the AddAssetSynthetic migration uses to recognise seeded demo hosts.
const SYNTHETIC_HOST = /^(www|api|auth|vpn|mail|portal|payments|cdn|admin|sso|gateway|app)\.(northwind|contoso|fabrikam|initech|umbrella|globex|acme|wayne|stark|hooli)-[0-9]+\.(com|net|io|org|ca|co\.uk)$/;

describe('REAL_TARGETS', () => {
  it('has at least 100 targets, each valid and listed once', () => {
    const keys = REAL_TARGETS.map(({ target }) => {
      const { host, port } = parseTarget(target);
      return `${host}:${port}`;
    });
    expect(keys.length).toBeGreaterThanOrEqual(100);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never looks like a synthetic demo host, so real results are never tagged Demo', () => {
    expect(REAL_TARGETS.filter(({ target }) => SYNTHETIC_HOST.test(parseTarget(target).host))).toEqual([]);
  });
});
