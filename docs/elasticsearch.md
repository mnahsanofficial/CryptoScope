# Elasticsearch: TLS handshake log analytics

CryptoScope's PostgreSQL tables hold the **inventory** (assets, scans, findings). Elasticsearch holds the
**traffic**: one document per TLS handshake, the kind of data a load balancer produces by the million.
Postgres answers "what is our configuration?"; Elasticsearch answers "what is actually happening on the wire?"

```bash
cd backend
npm run logs:generate                    # 500,000 handshakes over the last 7 days (~5 s)
npm run logs:generate -- --count 2000000 # more
curl -s localhost:3001/api/analytics/handshakes/quantum-vulnerable
```

Then open Kibana (http://localhost:5601), go to Discover, and pick the **TLS handshakes** data view
(the script creates it).

## 1. The document

```json
{
  "@timestamp": "2026-10-15T16:41:15.397Z",
  "host": "portal.hooli-424.com",
  "client_ip": "203.0.188.222",
  "tls_version": "TLSv1",
  "cipher": "DES-CBC3-SHA",
  "key_algorithm": "RSA",
  "key_size": 1024,
  "kex_group": "X25519",
  "quantum_vulnerable": true,
  "user_agent": "python-requests/2.32.3",
  "handshake_ms": 56.4
}
```

`quantum_vulnerable` means the **session key** was agreed with a classical key exchange (anything except the
hybrid `X25519MLKEM768`). That traffic could be recorded today and decrypted once a large quantum computer
exists ("harvest now, decrypt later").

## 2. Mapping: keyword vs text and other choices

The mapping is in [`handshake-index.ts`](../backend/src/analytics/handshake-index.ts).

| Field | Type | Why |
| --- | --- | --- |
| `@timestamp` | `date` | Range filters and `date_histogram`. Stored as epoch millis internally. |
| `host`, `tls_version`, `cipher`, `key_algorithm`, `kex_group` | `keyword` | Exact values: filtering (`term`), grouping (`terms` agg), sorting. Not split into words. |
| `user_agent` | `text` + `.keyword` sub-field | `text` is **analysed** (split into lowercase words: `mozilla`, `msie`, `8.0`…) for full-text search. `.keyword` keeps the exact string for "top user agents". |
| `client_ip` | `ip` | Enables CIDR queries (`client_ip: "10.0.0.0/8"`) and IP ranges. A string can't do that. |
| `key_size` | `short` | Smallest numeric type that fits. Numbers support range queries (`lt: 2048`). |
| `quantum_vulnerable` | `boolean` | Cheap exact filter. |
| `handshake_ms` | `float` | `avg`, `percentiles` aggregations. |

**keyword vs text in one sentence:** `keyword` stores the value as one exact token (for equality, aggregations
and sorting); `text` runs it through an analyzer into searchable words (for relevance search). Aggregating on a
`text` field needs `fielddata`, which is disabled by default because it loads all terms into heap memory.

Other choices:

- **`dynamic: "strict"`:** a document with an unknown field is rejected. Without it, Elasticsearch would guess
  types ("dynamic mapping"). Every string becomes `text` + `keyword` (double storage), IPs become strings, and
  a typo like `tls_verison` silently creates a new field.
- **1 shard, 0 replicas:** ~64 MB of data. Each shard has overhead; aim for roughly 10–50 GB per shard.
  Replicas can't be placed on a single-node cluster (status would be yellow forever).
- **Versioned index + alias:** data goes into `tls-handshakes-<timestamp>`; the API reads the alias
  `tls-handshakes`. Re-generating writes a new index, then **atomically** moves the alias and deletes the old
  one, so the API never sees a half-loaded index. The same pattern allows changing a mapping with zero downtime
  (create new index → reindex → switch alias). Production logs would use **data streams + ILM** (rollover by size
  or age, then delete old indices).

## 3. Bulk indexing

[`generate-handshake-logs.ts`](../backend/src/analytics/generator/generate-handshake-logs.ts) indexes
500,000 docs in about 4 s (about 96k docs/s end to end on a laptop):

| Technique | Why |
| --- | --- |
| `_bulk` API via `client.helpers.bulk` | One request per ~5 MB instead of one per document. |
| `flushBytes: 5 MB`, `concurrency: 3` | Batches of a few MB, a few in parallel. Bigger isn't always faster. |
| `retries: 3` | The helper retries documents rejected with **429 Too Many Requests** (back-pressure). |
| `refresh_interval: -1` during load | A refresh makes new data searchable by creating a segment. Pointless while bulk loading. |
| `number_of_replicas: 0` during load | Replicas would double the indexing work; add them afterwards. |
| `forcemerge` to 1 segment afterwards | Fewer segments = faster searches. Only for indices that won't change any more. |
| A generator as the data source | 500k docs are streamed, never all held in memory. |

## 4. The aggregations

All four use `size: 0` (no documents, just the aggregation) and put every condition in **filter context**.
The builders are in [`handshake-queries.ts`](../backend/src/analytics/handshake-queries.ts).
Results below are from the 500k generated logs.

### Count by key algorithm: `terms`

`GET /api/analytics/handshakes/key-algorithms`

```json
{ "size": 0, "track_total_hits": true,
  "query": { "bool": { "filter": [ { "range": { "@timestamp": { "gte": "now-7d/h", "lt": "now" } } } ] } },
  "aggs": { "by_algorithm": { "terms": { "field": "key_algorithm", "size": 20 },
                              "aggs": { "by_size": { "terms": { "field": "key_size" } } } } } }
```

EC 51.8% · RSA 45.4% (including 19,823 handshakes with RSA-1024 and 1,759 with RSA-512) · ML-DSA-65 2.8%.

### Weak handshakes per hour: `date_histogram` + `filter`

`GET /api/analytics/handshakes/weak-per-interval?interval=1h`

```json
"aggs": {
  "over_time": {
    "date_histogram": { "field": "@timestamp", "fixed_interval": "1h",
                        "min_doc_count": 0, "extended_bounds": { "min": "now-7d/h", "max": "now" } },
    "aggs": { "weak": { "filter": { "bool": { "should": [
      { "terms": { "tls_version": ["TLSv1", "TLSv1.1"] } },
      { "bool": { "filter": [ { "term": { "key_algorithm": "RSA" } }, { "range": { "key_size": { "lt": 2048 } } } ] } },
      { "terms": { "cipher": ["DES-CBC3-SHA", "RC4-SHA"] } }
    ], "minimum_should_match": 1 } } } }
  }
}
```

The response has 169 hourly buckets, each with `total`, `weak` and `weakPercentage`. Weak is 18.6% overall, but
the simulated **incident** stands out at about 45% for three hours (14:00–17:00 UTC, two days ago).
`min_doc_count: 0` + `extended_bounds` return empty hours as zeros so charts don't skip them.

### Top 10 hosts still using RSA < 2048: `terms` + metrics

`GET /api/analytics/handshakes/top-weak-rsa-hosts?limit=10`

A `terms` aggregation on `host` over the filtered set, with `min(key_size)`, `max(@timestamp)` (last seen) and
`cardinality(client_ip)` inside each bucket. Result: 21,618 weak-RSA handshakes on 105 hosts; the worst is
`www.stark-43.com` (RSA-1024, about 1,500 handshakes).

### Percentage of quantum-vulnerable traffic: `filter` agg + exact total

`GET /api/analytics/handshakes/quantum-vulnerable`

`track_total_hits: true` for the exact total, a `filter` aggregation for `quantum_vulnerable: true`, and a
`terms` aggregation on `kex_group` for the breakdown. Result: **85.4%** of traffic is quantum-vulnerable; only
the 14.6% that negotiated `X25519MLKEM768` is protected against harvest-now-decrypt-later.

## 5. Query context vs filter context

Every clause in a `bool` query runs in one of two contexts:

| | Query context | Filter context |
| --- | --- | --- |
| Question | "**How well** does this document match?" | "Does it match? **Yes or no**." |
| Clauses | `must`, `should` (at the top level) | `filter`, `must_not` |
| Relevance `_score` | calculated (BM25) | not calculated |
| Cacheable | no | yes (frequently used filters are cached as bitsets) |
| Use for | full-text search: "msie", "java client" | exact conditions: time ranges, `tls_version = TLSv1`, `host = x` |

The search endpoint uses both:

```json
GET /api/analytics/handshakes/search?q=msie&tlsVersion=TLSv1
{ "query": { "bool": {
    "must":   [ { "match": { "user_agent": "msie" } } ],                  // scored: ranks by relevance
    "filter": [ { "range": { "@timestamp": { "gte": "now-7d/h", "lt": "now" } } },
                { "term":  { "tls_version": "TLSv1" } } ] } },           // yes/no: no score, cacheable
  "sort": [ "_score", { "@timestamp": "desc" } ] }
```

Rule of thumb: **if the answer is yes/no, it belongs in `filter`.** Putting a `term` or `range` in `must`
gives the same hits but wastes CPU on scoring and can't be cached. Analytics never need a score, so every
aggregation endpoint uses filter context only.

## 6. Optimisation tips

1. **`size: 0` for analytics.** No hits to fetch, and responses with `size: 0` can be served from the
   **shard request cache**. On this dataset, a repeated call dropped from ~29 ms to ~4 ms, and
   `GET tls-handshakes/_stats/request_cache` showed the hit count going up.
2. **Filter context for exact conditions**: no scoring, and cacheable (see above).
3. **Round dates in date math** (`now-7d/h`, not `now-7d`). With `now` to the millisecond, every request is a
   different query; rounded, it's the same query for an hour.
4. **`track_total_hits` only when you need an exact count.** By default `hits.total` stops at 10,000
   (`"relation": "gte"`), so Elasticsearch can stop counting early. The percentage endpoint needs the exact
   total, so it sets `track_total_hits: true`.
5. **Aggregate on `keyword`/numeric fields.** They have `doc_values` (on-disk columnar storage) built for
   aggregations. Never enable `fielddata` on a `text` field to aggregate it.
6. **`cardinality` is approximate** (HyperLogLog++, very accurate below ~3,000 distinct values by default,
   tunable with `precision_threshold`). It uses fixed memory even with millions of values.
7. **`terms` on multiple shards is approximate too.** Each shard returns its local top N. Increase `shard_size`
   or check `doc_count_error_upper_bound`. (With one shard, as here, it's exact.)
8. **Avoid deep pagination.** `from + size` is capped at 10,000 (`index.max_result_window`) because every
   page re-sorts everything before it. For scrolling far, use `search_after` with a point-in-time (PIT).
   The API rejects `page * pageSize > 10000`.
9. **Do work at index time, not query time.** A boolean like `weak` (or a `weak_reasons` keyword array)
   computed during ingest would turn the `bool/should` above into a single `term` filter. It's a trade-off:
   faster queries, but you must re-index if the definition changes. Avoid `script` queries on hot paths.
10. **Right-size shards and use time-based indices** (data streams + ILM). Old data can move to cheaper nodes
    or be deleted by dropping a whole index, which is far cheaper than `delete_by_query`.
11. **Measure.** The `profile: true` search option and Kibana's Search Profiler show where time goes per shard
    and per clause.
