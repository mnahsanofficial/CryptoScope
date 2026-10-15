import type { estypes } from '@elastic/elasticsearch';

/** One TLS handshake as seen by a load balancer / TLS terminator. */
export interface HandshakeLog {
  '@timestamp': string;
  host: string;
  client_ip: string;
  tls_version: string;
  cipher: string;
  key_algorithm: string;
  key_size: number | null;
  /** Key exchange group, e.g. X25519 or the hybrid post-quantum X25519MLKEM768. */
  kex_group: string;
  /** True when the session key was agreed with a classical (quantum-breakable) key exchange. */
  quantum_vulnerable: boolean;
  user_agent: string;
  handshake_ms: number;
}

/**
 * Explicit mapping. Without one, Elasticsearch guesses ("dynamic mapping"): every string becomes
 * `text` + `keyword` (double the storage), IPs become plain strings, and a typo creates a new field.
 */
export const HANDSHAKE_MAPPINGS: estypes.MappingTypeMapping = {
  // Reject documents with unknown fields instead of silently growing the mapping.
  dynamic: 'strict',
  properties: {
    '@timestamp': { type: 'date' },
    // keyword = stored as one exact value: for filters, terms aggregations and sorting.
    host: { type: 'keyword' },
    tls_version: { type: 'keyword' },
    cipher: { type: 'keyword' },
    key_algorithm: { type: 'keyword' },
    kex_group: { type: 'keyword' },
    // ip type supports CIDR queries like client_ip: "10.0.0.0/8"
    client_ip: { type: 'ip' },
    // short is enough for key sizes (<= 32767) and uses less memory than long
    key_size: { type: 'short' },
    quantum_vulnerable: { type: 'boolean' },
    // text = analysed into words for full-text search ("chrome", "msie").
    // The .keyword sub-field keeps the exact string for aggregations ("top user agents").
    user_agent: {
      type: 'text',
      fields: { keyword: { type: 'keyword', ignore_above: 256 } },
    },
    handshake_ms: { type: 'float' },
  },
};

export const HANDSHAKE_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_shards: 1, // ~100 MB of logs: one shard is plenty (aim for 10-50 GB per shard)
  number_of_replicas: 0, // single-node dev cluster; replicas could never be assigned (status would be yellow)
};
