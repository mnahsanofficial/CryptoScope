import type { estypes } from '@elastic/elasticsearch';
import {
  buildKeyAlgorithmCounts,
  buildQuantumVulnerableShare,
  buildSearch,
  buildTopWeakRsaHosts,
  buildWeakPerInterval,
  WEAK_HANDSHAKE,
} from './handshake-queries';

const RANGE = { from: '2026-06-01T00:00:00Z', to: '2026-06-08T00:00:00Z' };
const boolOf = (req: estypes.SearchRequest) => req.query!.bool!;

describe('handshake queries', () => {
  it.each([
    ['key algorithms', buildKeyAlgorithmCounts(RANGE)],
    ['weak per interval', buildWeakPerInterval(RANGE, '1h')],
    ['top weak RSA hosts', buildTopWeakRsaHosts(RANGE, 10)],
    ['quantum share', buildQuantumVulnerableShare(RANGE)],
  ])('%s: aggregation-only (size 0), exact totals, everything in filter context', (_, req) => {
    expect(req.size).toBe(0);
    expect(req.track_total_hits).toBe(true);
    expect(boolOf(req).must).toBeUndefined(); // nothing is scored
    expect(boolOf(req).filter).toContainEqual({ range: { '@timestamp': { gte: RANGE.from, lt: RANGE.to } } });
  });

  it('key algorithm counts use a terms aggregation on the keyword field', () => {
    const aggs = buildKeyAlgorithmCounts(RANGE).aggs!;
    expect(aggs.by_algorithm.terms).toMatchObject({ field: 'key_algorithm' });
    expect(aggs.by_algorithm.aggs!.by_size.terms).toMatchObject({ field: 'key_size' });
  });

  it('weak per interval: date_histogram with empty buckets and a weak filter inside each bucket', () => {
    const aggs = buildWeakPerInterval(RANGE, '6h').aggs!;
    expect(aggs.over_time.date_histogram).toEqual({
      field: '@timestamp',
      fixed_interval: '6h',
      min_doc_count: 0,
      extended_bounds: { min: RANGE.from, max: '2026-06-07T23:59:59.999Z' }, // end is exclusive
    });
    expect(aggs.over_time.aggs!.weak).toEqual({ filter: WEAK_HANDSHAKE });
  });

  it('keeps date math like "now" as the last bucket bound', () => {
    const aggs = buildWeakPerInterval({ from: 'now-7d/h', to: 'now' }, '1h').aggs!;
    expect(aggs.over_time.date_histogram!.extended_bounds).toEqual({ min: 'now-7d/h', max: 'now' });
  });

  it('a weak handshake is legacy TLS OR a short RSA key OR a weak cipher', () => {
    const bool = WEAK_HANDSHAKE.bool!;
    expect(bool.minimum_should_match).toBe(1);
    expect(bool.should).toEqual(
      expect.arrayContaining([
        { terms: { tls_version: ['TLSv1', 'TLSv1.1'] } },
        { terms: { cipher: ['DES-CBC3-SHA', 'RC4-SHA'] } },
      ]),
    );
  });

  it('top weak RSA hosts filters RSA keys below 2048 bits and limits the terms size', () => {
    const req = buildTopWeakRsaHosts(RANGE, 7);
    expect(JSON.stringify(boolOf(req).filter)).toContain('"key_size":{"lt":2048}');
    expect(req.aggs!.hosts.terms).toMatchObject({ field: 'host', size: 7 });
  });

  describe('search (query vs filter context)', () => {
    it('puts free text in query context (scored) and exact conditions in filter context', () => {
      const req = buildSearch(RANGE, { q: 'msie', tlsVersion: 'TLSv1', host: 'a.com', page: 2, pageSize: 10 });

      expect(boolOf(req).must).toEqual([{ match: { user_agent: { query: 'msie' } } }]);
      expect(boolOf(req).filter).toEqual(
        expect.arrayContaining([{ term: { tls_version: 'TLSv1' } }, { term: { host: 'a.com' } }]),
      );
      expect(req.sort).toEqual(['_score', { '@timestamp': 'desc' }]);
      expect(req).toMatchObject({ from: 10, size: 10 });
    });

    it('without free text there is nothing to score, so it sorts by time only', () => {
      const req = buildSearch(RANGE, { page: 1, pageSize: 20 });
      expect(boolOf(req).must).toEqual([]);
      expect(req.sort).toEqual([{ '@timestamp': 'desc' }]);
    });
  });
});
