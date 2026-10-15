import type { estypes } from '@elastic/elasticsearch';
import { HandshakeLog } from './handshake-index';

/** Turns raw Elasticsearch responses into small, UI-friendly JSON. Pure, so easy to unit-test. */

export const percentage = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 10_000) / 100; // two decimals

/** hits.total is a number or { value, relation }. With track_total_hits: true it is exact. */
export function totalHits(response: Pick<estypes.SearchResponse, 'hits'>): number {
  const total = response.hits.total;
  return typeof total === 'number' ? total : (total?.value ?? 0);
}

interface Bucket<K = string> {
  key: K;
  key_as_string?: string;
  doc_count: number;
}

// ---- key algorithm counts ----
export interface KeyAlgorithmAggs {
  by_algorithm: { buckets: Array<Bucket & { by_size: { buckets: Bucket<number>[] } }> };
}

export function mapKeyAlgorithmCounts(response: estypes.SearchResponse<unknown, KeyAlgorithmAggs>) {
  const total = totalHits(response);
  return {
    total,
    algorithms: response.aggregations!.by_algorithm.buckets.map((b) => ({
      keyAlgorithm: b.key,
      count: b.doc_count,
      percentage: percentage(b.doc_count, total),
      keySizes: b.by_size.buckets.map((s) => ({ keySize: s.key, count: s.doc_count })),
    })),
  };
}

// ---- weak handshakes over time ----
export interface WeakPerIntervalAggs {
  over_time: { buckets: Array<Bucket<number> & { weak: { doc_count: number } }> };
  weak_total: { doc_count: number };
  weak_reasons: { buckets: Record<string, { doc_count: number }> };
}

export function mapWeakPerInterval(response: estypes.SearchResponse<unknown, WeakPerIntervalAggs>, interval: string) {
  const total = totalHits(response);
  const aggs = response.aggregations!;
  return {
    interval,
    total,
    weak: aggs.weak_total.doc_count,
    weakPercentage: percentage(aggs.weak_total.doc_count, total),
    reasons: Object.fromEntries(Object.entries(aggs.weak_reasons.buckets).map(([k, v]) => [k, v.doc_count])),
    buckets: aggs.over_time.buckets.map((b) => ({
      timestamp: b.key_as_string ?? new Date(b.key).toISOString(),
      total: b.doc_count,
      weak: b.weak.doc_count,
      weakPercentage: percentage(b.weak.doc_count, b.doc_count),
    })),
  };
}

// ---- top hosts with weak RSA keys ----
export interface TopWeakRsaHostsAggs {
  hosts: {
    buckets: Array<
      Bucket & {
        key_size: { value: number | null };
        last_seen: { value_as_string?: string; value: number | null };
        distinct_clients: { value: number };
      }
    >;
  };
  affected_hosts: { value: number };
}

export function mapTopWeakRsaHosts(response: estypes.SearchResponse<unknown, TopWeakRsaHostsAggs>) {
  const aggs = response.aggregations!;
  return {
    weakRsaHandshakes: totalHits(response),
    affectedHosts: aggs.affected_hosts.value,
    hosts: aggs.hosts.buckets.map((b) => ({
      host: b.key,
      handshakes: b.doc_count,
      keySize: b.key_size.value,
      lastSeen: b.last_seen.value_as_string ?? null,
      distinctClients: b.distinct_clients.value,
    })),
  };
}

// ---- quantum-vulnerable share ----
export interface QuantumVulnerableAggs {
  vulnerable: { doc_count: number };
  by_kex_group: { buckets: Bucket[] };
}

export function mapQuantumVulnerableShare(response: estypes.SearchResponse<unknown, QuantumVulnerableAggs>) {
  const total = totalHits(response);
  const vulnerable = response.aggregations!.vulnerable.doc_count;
  return {
    total,
    quantumVulnerable: vulnerable,
    quantumSafe: total - vulnerable,
    percentage: percentage(vulnerable, total),
    byKeyExchangeGroup: response.aggregations!.by_kex_group.buckets.map((b) => ({
      group: b.key,
      count: b.doc_count,
      percentage: percentage(b.doc_count, total),
    })),
  };
}

// ---- search ----
export function mapSearch(response: estypes.SearchResponse<HandshakeLog>, page: number, pageSize: number) {
  const total = totalHits(response);
  return {
    data: response.hits.hits.map((hit) => ({ id: hit._id, score: hit._score ?? null, ...hit._source! })),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
