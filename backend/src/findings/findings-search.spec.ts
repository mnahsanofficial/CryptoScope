import type { estypes } from '@elastic/elasticsearch';
import { versionedIndexName } from './findings-index';
import { buildFindingsSearch, FindingsSearchAggs, HIGHLIGHT_END, HIGHLIGHT_START, mapFindingsSearch, MAX_SEARCH_TERMS, wordClauses } from './findings-search';
import type { FindingDocument } from './findings-index';

const base = { q: 'zeuz tls', currentOnly: true, page: 2, pageSize: 20 };

describe('findings search query', () => {
  it('requires every word, each matching in any field as a prefix or with typo tolerance', () => {
    const clauses = wordClauses('  qa.zeuz.ai   expird ');
    expect(clauses).toHaveLength(2);
    const should = clauses[0].bool!.should as estypes.QueryDslQueryContainer[];
    expect(should[0].multi_match).toMatchObject({ query: 'qa.zeuz.ai', fuzziness: 'AUTO' });
    expect(should[1].multi_match).toMatchObject({ query: 'qa.zeuz.ai', type: 'phrase_prefix' });
    expect(clauses[0].bool!.minimum_should_match).toBe(1);
  });

  it(`caps the number of words at ${MAX_SEARCH_TERMS} to bound query cost`, () => {
    expect(wordClauses(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' '))).toHaveLength(MAX_SEARCH_TERMS);
  });

  it('puts "current only" and rule in filter context, severity/category in post_filter', () => {
    const req = buildFindingsSearch({ ...base, severity: ['critical'], category: ['quantum'], ruleId: ['CERT_EXPIRED'] });

    expect(req.query!.bool!.filter).toEqual([{ term: { is_current: true } }, { terms: { rule_id: ['CERT_EXPIRED'] } }]);
    expect(req.post_filter).toEqual({ bool: { filter: [{ terms: { severity: ['critical'] } }, { terms: { category: ['quantum'] } }] } });
    expect(req.aggs).toHaveProperty('by_severity');
    expect(req).toMatchObject({ from: 20, size: 20, sort: ['_score', { created_at: 'desc' }] });
  });

  it('omits post_filter and the current-only filter when not requested', () => {
    const req = buildFindingsSearch({ ...base, currentOnly: false });
    expect(req.post_filter).toBeUndefined();
    expect(req.query!.bool!.filter).toEqual([]);
  });

  it('highlights with control-character markers, never HTML tags', () => {
    expect(buildFindingsSearch(base).highlight).toMatchObject({ pre_tags: [HIGHLIGHT_START], post_tags: [HIGHLIGHT_END] });
  });
});

describe('mapFindingsSearch', () => {
  it('maps hits, highlights, facets and paging', () => {
    const doc = {
      finding_id: 'f1', scan_id: 's1', asset_id: 'a1', host: 'qa.zeuz.ai', port: 443, environment: 'production',
      rule_id: 'QUANTUM_VULNERABLE_KEY', severity: 'medium', category: 'quantum', title: 'Quantum-vulnerable public key',
      description: 'd', recommendation: 'r', evidence: {}, risk_score: 10, risk_level: 'medium', is_current: true,
      created_at: '2026-10-17T00:00:00Z',
    } as FindingDocument;
    const response = {
      took: 7,
      timed_out: false,
      _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
      hits: { total: { value: 41, relation: 'eq' }, hits: [{ _index: 'i', _id: 'f1', _score: 3.2, _source: doc, highlight: { 'host.parts': [`qa.${HIGHLIGHT_START}zeuz${HIGHLIGHT_END}.ai`] } }] },
      aggregations: { by_severity: { buckets: [{ key: 'medium', doc_count: 41 }] }, by_category: { buckets: [{ key: 'quantum', doc_count: 41 }] } },
    } as unknown as estypes.SearchResponse<FindingDocument, FindingsSearchAggs>;

    const result = mapFindingsSearch(response, { page: 1, pageSize: 20 });

    expect(result).toMatchObject({ took: 7, facets: { severity: { medium: 41 }, category: { quantum: 41 } }, meta: { total: 41, totalPages: 3 } });
    expect(result.data[0]).toMatchObject({ id: 'f1', host: 'qa.zeuz.ai', isCurrent: true, score: 3.2, highlight: { host: `qa.${HIGHLIGHT_START}zeuz${HIGHLIGHT_END}.ai` } });
  });
});

describe('versionedIndexName', () => {
  it('appends a sortable timestamp', () => {
    expect(versionedIndexName('cryptoscope-findings', new Date('2026-10-17T17:38:43.123Z'))).toBe('cryptoscope-findings-20261017173843');
  });
});
