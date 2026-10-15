import type { estypes } from '@elastic/elasticsearch';
import {
  mapKeyAlgorithmCounts,
  mapQuantumVulnerableShare,
  mapTopWeakRsaHosts,
  mapWeakPerInterval,
  percentage,
  totalHits,
} from './handshake-mappers';

/** Minimal fake search response: only the parts the mappers read. */
function response<TAggs>(total: number, aggregations: TAggs) {
  return {
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    hits: { total: { value: total, relation: 'eq' }, hits: [] },
    aggregations,
  } as unknown as estypes.SearchResponse<unknown, TAggs>;
}

describe('handshake mappers', () => {
  it('percentage rounds to two decimals and never divides by zero', () => {
    expect(percentage(1, 3)).toBe(33.33);
    expect(percentage(5, 0)).toBe(0);
  });

  it('totalHits reads both the number and the { value, relation } form', () => {
    expect(totalHits({ hits: { total: 7, hits: [] } })).toBe(7);
    expect(totalHits({ hits: { total: { value: 9, relation: 'eq' }, hits: [] } })).toBe(9);
  });

  it('maps key algorithm buckets with percentages', () => {
    const result = mapKeyAlgorithmCounts(
      response(200, {
        by_algorithm: {
          buckets: [
            { key: 'EC', doc_count: 150, by_size: { buckets: [{ key: 256, doc_count: 150 }] } },
            { key: 'RSA', doc_count: 50, by_size: { buckets: [{ key: 1024, doc_count: 50 }] } },
          ],
        },
      }),
    );

    expect(result).toEqual({
      total: 200,
      algorithms: [
        { keyAlgorithm: 'EC', count: 150, percentage: 75, keySizes: [{ keySize: 256, count: 150 }] },
        { keyAlgorithm: 'RSA', count: 50, percentage: 25, keySizes: [{ keySize: 1024, count: 50 }] },
      ],
    });
  });

  it('maps weak-per-interval buckets, including empty hours', () => {
    const result = mapWeakPerInterval(
      response(10, {
        over_time: {
          buckets: [
            { key: 0, key_as_string: '2026-06-01T00:00:00.000Z', doc_count: 10, weak: { doc_count: 4 } },
            { key: 3600000, key_as_string: '2026-06-01T01:00:00.000Z', doc_count: 0, weak: { doc_count: 0 } },
          ],
        },
        weak_total: { doc_count: 4 },
        weak_reasons: { buckets: { legacy_protocol: { doc_count: 3 }, weak_cipher: { doc_count: 2 } } },
      }),
      '1h',
    );

    expect(result).toMatchObject({ total: 10, weak: 4, weakPercentage: 40, reasons: { legacy_protocol: 3, weak_cipher: 2 } });
    expect(result.buckets[1]).toEqual({ timestamp: '2026-06-01T01:00:00.000Z', total: 0, weak: 0, weakPercentage: 0 });
  });

  it('maps top weak RSA hosts', () => {
    const result = mapTopWeakRsaHosts(
      response(30, {
        hosts: {
          buckets: [
            {
              key: 'old.example.com',
              doc_count: 30,
              key_size: { value: 1024 },
              last_seen: { value: 1, value_as_string: '2026-06-07T10:00:00.000Z' },
              distinct_clients: { value: 12 },
            },
          ],
        },
        affected_hosts: { value: 1 },
      }),
    );

    expect(result).toEqual({
      weakRsaHandshakes: 30,
      affectedHosts: 1,
      hosts: [{ host: 'old.example.com', handshakes: 30, keySize: 1024, lastSeen: '2026-06-07T10:00:00.000Z', distinctClients: 12 }],
    });
  });

  it('computes the quantum-vulnerable share', () => {
    const result = mapQuantumVulnerableShare(
      response(8, {
        vulnerable: { doc_count: 6 },
        by_kex_group: { buckets: [{ key: 'X25519', doc_count: 6 }, { key: 'X25519MLKEM768', doc_count: 2 }] },
      }),
    );

    expect(result).toMatchObject({ total: 8, quantumVulnerable: 6, quantumSafe: 2, percentage: 75 });
    expect(result.byKeyExchangeGroup[1]).toEqual({ group: 'X25519MLKEM768', count: 2, percentage: 25 });
  });

  it('handles an empty time range', () => {
    const result = mapQuantumVulnerableShare(response(0, { vulnerable: { doc_count: 0 }, by_kex_group: { buckets: [] } }));
    expect(result).toMatchObject({ total: 0, percentage: 0 });
  });
});
