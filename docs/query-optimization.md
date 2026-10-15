# Query optimisation: the findings list

Reproduce it yourself:

```bash
cd backend
npm run seed             # 20,000 assets, 100,000 scans, ~39,000 certificates, ~199,000 findings
npm run db:explain-demo  # EXPLAIN ANALYZE without and with the index
```

The demo builds the query with the same `FindingsService.buildListQuery()` the API uses, so it measures
exactly what `GET /api/findings?severity=critical` runs. "Before" is measured inside a transaction that
drops the index and is then rolled back (Postgres DDL is transactional), so nothing is changed.

## The slow query

"Show me the newest critical findings" is the first thing a security dashboard asks:

```sql
SELECT finding.*, asset.id, asset.host, asset.port, asset.label
FROM findings finding
LEFT JOIN assets asset ON asset.id = finding.asset_id
WHERE finding.severity IN ('critical')
ORDER BY finding.created_at DESC, finding.id DESC
LIMIT 20 OFFSET 0;
```

## Before: no suitable index (198,763 findings)

```
Limit  (actual time=13.215..15.749 rows=20 loops=1)
  Buffers: shared hit=8454 read=2866
  ->  Nested Loop Left Join
        ->  Gather Merge
              Workers Planned: 2
              ->  Sort  (rows=127 loops=3)
                    Sort Key: finding.created_at DESC, finding.id DESC
                    Sort Method: quicksort  Memory: 1017kB
                    ->  Parallel Seq Scan on findings finding  (rows=1388 loops=3)
                          Filter: (severity = 'critical'::finding_severity)
                          Rows Removed by Filter: 64866
        ->  Index Scan using pk_assets on assets asset
Execution Time: 15.808 ms
```

How to read it (from the inside out):

1. **Parallel Seq Scan:** three processes read **every row** of `findings` (11,320 pages, about 88 MB).
2. **Filter / Rows Removed by Filter: 64,866 per process.** About 98% of what was read is thrown away,
   because only about 2% of findings are critical.
3. **Sort:** all ~4,100 critical findings are sorted by date, just to keep the newest 20.
4. **Limit:** finally takes 20 rows.

The work is proportional to the **whole table**, not to the 20 rows we return. At 10x the data
it would be about 10x slower, and it already reads about 88 MB per page view.

## The fix

```sql
CREATE INDEX idx_findings_severity_created_at ON findings (severity, created_at, id);
```

(Migration `1792100100000-AddFindingsSeverityCreatedAtIndex`.)

Why this column order:

- **`severity` first** because it is an equality filter. Postgres jumps straight to the
  `critical` section of the B-tree.
- **`created_at` second.** Inside that section, entries are already sorted by date. Postgres can read a
  B-tree **backwards**, so `DESC` needs no separate descending index.
- **`id` third** because it is the API's tie-breaker (`ORDER BY created_at DESC, id DESC`). Findings from
  the same scan share a timestamp; including `id` means the index order matches the **entire** ORDER BY,
  so there is no sort step at all.

The rule of thumb: **equality columns first, then the ORDER BY columns, in the same order.**

## After

```
Limit  (actual time=0.032..0.057 rows=20 loops=1)
  Buffers: shared hit=85
  ->  Nested Loop Left Join
        ->  Index Scan Backward using idx_findings_severity_created_at on findings finding  (rows=20 loops=1)
              Index Cond: (severity = 'critical'::finding_severity)
              Buffers: shared hit=25
        ->  Memoize
              ->  Index Scan using pk_assets on assets asset
Execution Time: 0.074 ms
```

- **Index Scan Backward** with **Index Cond** (not Filter): only matching entries are touched.
- No Sort node: rows come out of the index already in the right order.
- It stops after **20 rows**. The cost no longer depends on table size.

| | Before | After |
| --- | --- | --- |
| Execution time (best of 5) | 15.808 ms | 0.074 ms (**214x faster**) |
| Pages read (8 KB each) | 11,320 (~88 MB) | 85 (~680 KB) |
| Rows read to return 20 | ~198,800 | 20 |
| Sort | in-memory quicksort, 1 MB | none |

## Trade-offs and what else to know

- **Indexes are not free.** Every INSERT into `findings` now also updates this B-tree, and it uses disk space.
  The table is read far more often (every dashboard view) than written (once per scan), so it's worth it.
- **Postgres does not index foreign keys automatically.** The initial migration adds
  `idx_findings_scan_id`, `idx_findings_asset_id_created_at`, `idx_scans_asset_id_scanned_at` and
  `idx_scans_certificate_id`. Without them, `ON DELETE CASCADE` from `assets` would seq-scan `findings`.
- **Several severities** (`IN ('critical','high')`) can't be served in date order by one index range.
  Postgres has to merge or sort. It's still much better than a full scan, but slower than one value.
- **Deep pagination.** `OFFSET 10000` still walks 10,000 index entries. For "infinite scroll", keyset
  pagination (`WHERE (created_at, id) < ($lastCreatedAt, $lastId)`) keeps every page as fast as page 1.
- **Statistics.** The seed script runs `VACUUM ANALYZE`, so the planner has fresh row estimates
  (`rows=4095` estimated vs ~4,164 actual) and the visibility map allows index-only scans for counts.
- **`EXPLAIN` vs `EXPLAIN ANALYZE`.** `EXPLAIN` only shows the plan and estimates. `ANALYZE` actually runs the
  query and reports real times and row counts. `BUFFERS` shows the I/O, which is often a better signal than
  time on a small dataset.
