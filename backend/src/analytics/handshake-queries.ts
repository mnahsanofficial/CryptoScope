import type { estypes } from '@elastic/elasticsearch';

/**
 * Pure functions that build Elasticsearch request bodies. Kept apart from the service so the
 * query shapes can be unit-tested and read without any Elasticsearch running.
 *
 * Rule of thumb used everywhere below:
 *   - FILTER context ("does it match? yes/no"): exact conditions. No scoring, and results can be cached.
 *   - QUERY context ("how well does it match?"): only for full-text relevance (see buildSearch).
 */

export interface TimeRange {
  /** ISO 8601 or Elasticsearch date math, e.g. "now-7d/h" (rounded to the hour). */
  from: string;
  to: string;
}

export const LEGACY_TLS_VERSIONS = ['TLSv1', 'TLSv1.1'];
export const WEAK_CIPHERS = ['DES-CBC3-SHA', 'RC4-SHA'];
export const MIN_RSA_BITS = 2048;

const inRange = ({ from, to }: TimeRange): estypes.QueryDslQueryContainer => ({
  range: { '@timestamp': { gte: from, lt: to } },
});

const weakRsaKey: estypes.QueryDslQueryContainer = {
  bool: { filter: [{ term: { key_algorithm: 'RSA' } }, { range: { key_size: { lt: MIN_RSA_BITS } } }] },
};

/** A handshake is "weak" if ANY of these is true (bool.should with minimum_should_match: 1 = OR). */
export const WEAK_REASONS: Record<string, estypes.QueryDslQueryContainer> = {
  legacy_protocol: { terms: { tls_version: LEGACY_TLS_VERSIONS } },
  weak_rsa_key: weakRsaKey,
  weak_cipher: { terms: { cipher: WEAK_CIPHERS } },
};

export const WEAK_HANDSHAKE: estypes.QueryDslQueryContainer = {
  bool: { should: Object.values(WEAK_REASONS), minimum_should_match: 1 },
};

/** Count by key_algorithm (terms aggregation), with a key_size breakdown inside each bucket. */
export function buildKeyAlgorithmCounts(range: TimeRange): estypes.SearchRequest {
  return {
    size: 0, // we only want aggregations, not documents (also makes the response cacheable)
    track_total_hits: true, // otherwise hits.total stops counting at 10,000
    query: { bool: { filter: [inRange(range)] } },
    aggs: {
      by_algorithm: {
        terms: { field: 'key_algorithm', size: 20 },
        aggs: { by_size: { terms: { field: 'key_size', size: 10 } } },
      },
    },
  };
}

/**
 * extended_bounds is inclusive, but our range end is exclusive (lt). For a concrete end time like
 * 14:00 we stop 1 ms earlier, so no empty 14:00 bucket appears. Date math like "now" is left as is.
 */
function lastBucketBound(to: string): string {
  const time = Date.parse(to);
  return Number.isNaN(time) ? to : new Date(time - 1).toISOString();
}

/** Weak handshakes per time bucket: date_histogram with a filter sub-aggregation. */
export function buildWeakPerInterval(range: TimeRange, interval: string): estypes.SearchRequest {
  return {
    size: 0,
    track_total_hits: true,
    query: { bool: { filter: [inRange(range)] } },
    aggs: {
      over_time: {
        date_histogram: {
          field: '@timestamp',
          fixed_interval: interval,
          // Return empty buckets too, so a chart shows "0" instead of skipping the hour.
          min_doc_count: 0,
          extended_bounds: { min: range.from, max: lastBucketBound(range.to) },
        },
        aggs: { weak: { filter: WEAK_HANDSHAKE } },
      },
      weak_total: { filter: WEAK_HANDSHAKE },
      // One bucket per reason. A handshake can match several reasons.
      weak_reasons: { filters: { filters: WEAK_REASONS } },
    },
  };
}

/** Top hosts still serving RSA keys shorter than 2048 bits. */
export function buildTopWeakRsaHosts(range: TimeRange, limit: number): estypes.SearchRequest {
  return {
    size: 0,
    track_total_hits: true,
    query: { bool: { filter: [inRange(range), weakRsaKey] } },
    aggs: {
      hosts: {
        terms: { field: 'host', size: limit }, // ordered by doc count (most handshakes first)
        aggs: {
          key_size: { min: { field: 'key_size' } },
          last_seen: { max: { field: '@timestamp' } },
          // Approximate distinct count (HyperLogLog++): cheap even with millions of values.
          distinct_clients: { cardinality: { field: 'client_ip' } },
        },
      },
      affected_hosts: { cardinality: { field: 'host' } },
    },
  };
}

/** Share of traffic whose session key was agreed with a quantum-breakable key exchange. */
export function buildQuantumVulnerableShare(range: TimeRange): estypes.SearchRequest {
  return {
    size: 0,
    track_total_hits: true,
    query: { bool: { filter: [inRange(range)] } },
    aggs: {
      vulnerable: { filter: { term: { quantum_vulnerable: true } } },
      by_kex_group: { terms: { field: 'kex_group', size: 10 } },
    },
  };
}

export interface SearchParams {
  q?: string;
  tlsVersion?: string;
  host?: string;
  page: number;
  pageSize: number;
}

/**
 * Log search. The free-text part goes in QUERY context (must + match), so results are ranked by relevance.
 * Exact conditions go in FILTER context: they don't affect the score and Elasticsearch can cache them.
 */
export function buildSearch(range: TimeRange, params: SearchParams): estypes.SearchRequest {
  const filter: estypes.QueryDslQueryContainer[] = [inRange(range)];
  if (params.tlsVersion) filter.push({ term: { tls_version: params.tlsVersion } });
  if (params.host) filter.push({ term: { host: params.host } });

  return {
    from: (params.page - 1) * params.pageSize,
    size: params.pageSize,
    track_total_hits: true,
    query: {
      bool: {
        must: params.q ? [{ match: { user_agent: { query: params.q } } }] : [],
        filter,
      },
    },
    sort: params.q ? ['_score', { '@timestamp': 'desc' }] : [{ '@timestamp': 'desc' }],
  };
}
