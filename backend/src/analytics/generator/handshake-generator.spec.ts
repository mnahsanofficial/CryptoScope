import { HANDSHAKE_MAPPINGS, HandshakeLog } from '../handshake-index';
import { LEGACY_TLS_VERSIONS } from '../handshake-queries';
import { generateHandshakes, HYBRID_PQ_GROUP, incidentWindow } from './handshake-generator';

const END = new Date('2026-06-15T12:34:00.000Z');
const OPTIONS = { count: 20_000, hostCount: 300, days: 7, end: END, seed: 42 };
const logs: HandshakeLog[] = [...generateHandshakes(OPTIONS)];

describe('generateHandshakes', () => {
  it('produces exactly `count` documents', () => {
    expect(logs).toHaveLength(OPTIONS.count);
  });

  it('is deterministic for a given seed', () => {
    const again = [...generateHandshakes({ ...OPTIONS, count: 50 })];
    expect(again).toEqual(logs.slice(0, 50));
  });

  it('only uses fields that exist in the strict mapping (otherwise bulk indexing would reject them)', () => {
    const mapped = Object.keys(HANDSHAKE_MAPPINGS.properties!).sort();
    for (const doc of logs.slice(0, 100)) {
      expect(Object.keys(doc).sort()).toEqual(mapped);
    }
  });

  it('keeps every timestamp inside the requested window', () => {
    const start = END.getTime() - 7 * 24 * 3600 * 1000;
    for (const doc of logs) {
      const t = Date.parse(doc['@timestamp']);
      expect(t).toBeGreaterThanOrEqual(start);
      expect(t).toBeLessThan(END.getTime());
    }
  });

  it('is internally consistent: hybrid PQ key exchange only on TLS 1.3, and quantum_vulnerable matches it', () => {
    for (const doc of logs) {
      expect(doc.quantum_vulnerable).toBe(doc.kex_group !== HYBRID_PQ_GROUP);
      if (doc.kex_group === HYBRID_PQ_GROUP) expect(doc.tls_version).toBe('TLSv1.3');
      if (doc.tls_version === 'TLSv1.3') expect(doc.cipher).toMatch(/^TLS_/);
    }
  });

  it('contains every case the analytics need (weak RSA, legacy TLS, PQ and classical traffic)', () => {
    expect(logs.some((d) => d.key_algorithm === 'RSA' && d.key_size! < 2048)).toBe(true);
    expect(logs.some((d) => LEGACY_TLS_VERSIONS.includes(d.tls_version))).toBe(true);
    expect(logs.some((d) => !d.quantum_vulnerable)).toBe(true);
    expect(logs.some((d) => d.quantum_vulnerable)).toBe(true);
  });

  it('has a clear spike of legacy handshakes during the incident window', () => {
    const { start, end } = incidentWindow(END);
    const legacyShare = (docs: HandshakeLog[]) =>
      docs.filter((d) => LEGACY_TLS_VERSIONS.includes(d.tls_version)).length / docs.length;
    const during = logs.filter((d) => Date.parse(d['@timestamp']) >= start && Date.parse(d['@timestamp']) < end);
    const outside = logs.filter((d) => Date.parse(d['@timestamp']) < start || Date.parse(d['@timestamp']) >= end);

    expect(during.length).toBeGreaterThan(0);
    expect(legacyShare(during)).toBeGreaterThan(2 * legacyShare(outside));
  });
});
