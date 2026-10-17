import type { estypes } from '@elastic/elasticsearch';
import { FindingCategory, Severity } from '../risk/risk.types';
import { FindingDocument } from './findings-index';

/**
 * Highlight markers: control characters instead of "<mark>" HTML. The frontend splits on them and
 * renders real elements, so nothing from the index is ever inserted into the page as raw HTML (no XSS).
 */
export const HIGHLIGHT_START = '\u0001';
export const HIGHLIGHT_END = '\u0002';

export interface FindingsSearchParams {
  q: string;
  severity?: Severity[];
  category?: FindingCategory[];
  ruleId?: string[];
  currentOnly: boolean;
  page: number;
  pageSize: number;
}

/** Fields searched by the free text, with weights: a hit in the host name counts most. */
export const SEARCH_FIELDS = ['host.parts^3', 'title^2', 'description', 'recommendation'];
export const MAX_SEARCH_TERMS = 10;

/**
 * One clause per word, all required (AND across words). Each word may match in ANY field (OR across
 * fields), either as a prefix (search-as-you-type: "zeu" -> "zeuz") or with typo tolerance
 * ("expird" -> "expired"). This way "globex tls" finds findings whose host contains "globex" and whose
 * text mentions TLS: a plain multi_match with operator "and" would require both words in ONE field.
 */
export function wordClauses(q: string): estypes.QueryDslQueryContainer[] {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS);
  return words.map((word) => ({
    bool: {
      should: [
        { multi_match: { query: word, fields: SEARCH_FIELDS, fuzziness: 'AUTO', prefix_length: 1 } },
        { multi_match: { query: word, fields: SEARCH_FIELDS, type: 'phrase_prefix' } },
      ],
      minimum_should_match: 1,
    },
  }));
}

export function buildFindingsSearch(params: FindingsSearchParams): estypes.SearchRequest {
  const facetFilters: estypes.QueryDslQueryContainer[] = [];
  if (params.severity?.length) facetFilters.push({ terms: { severity: params.severity } });
  if (params.category?.length) facetFilters.push({ terms: { category: params.category } });

  const filter: estypes.QueryDslQueryContainer[] = [];
  if (params.currentOnly) filter.push({ term: { is_current: true } });
  if (params.ruleId?.length) filter.push({ terms: { rule_id: params.ruleId } });

  return {
    from: (params.page - 1) * params.pageSize,
    size: params.pageSize,
    track_total_hits: true,
    query: {
      bool: {
        // QUERY context: every word must match somewhere; results are ranked by relevance.
        must: wordClauses(params.q),
        // FILTER context: yes/no, no scoring, cacheable.
        filter,
      },
    },
    // Severity/category are applied AFTER the aggregations (post_filter), so the facet counts show every
    // severity for the current search: picking "critical" doesn't make the other counts drop to zero.
    ...(facetFilters.length ? { post_filter: { bool: { filter: facetFilters } } } : {}),
    aggs: {
      by_severity: { terms: { field: 'severity', size: 10 } },
      by_category: { terms: { field: 'category', size: 10 } },
    },
    highlight: {
      pre_tags: [HIGHLIGHT_START],
      post_tags: [HIGHLIGHT_END],
      // number_of_fragments 0 = return the whole field with the matches marked
      fields: { title: { number_of_fragments: 0 }, description: { number_of_fragments: 0 }, 'host.parts': { number_of_fragments: 0 } },
    },
    sort: ['_score', { created_at: 'desc' }],
    _source: { excludes: ['evidence'] },
  };
}

interface Bucket {
  key: string;
  doc_count: number;
}
export interface FindingsSearchAggs {
  by_severity: { buckets: Bucket[] };
  by_category: { buckets: Bucket[] };
}

const counts = (buckets: Bucket[]) => Object.fromEntries(buckets.map((b) => [b.key, b.doc_count]));

export function mapFindingsSearch(
  response: estypes.SearchResponse<FindingDocument, FindingsSearchAggs>,
  params: Pick<FindingsSearchParams, 'page' | 'pageSize'>,
) {
  const total = typeof response.hits.total === 'number' ? response.hits.total : (response.hits.total?.value ?? 0);
  return {
    took: response.took, // milliseconds spent inside Elasticsearch
    data: response.hits.hits.map((hit) => {
      const d = hit._source!;
      return {
        id: d.finding_id,
        scanId: d.scan_id,
        assetId: d.asset_id,
        host: d.host,
        port: d.port,
        environment: d.environment,
        ruleId: d.rule_id,
        severity: d.severity,
        category: d.category,
        title: d.title,
        description: d.description,
        recommendation: d.recommendation,
        isCurrent: d.is_current,
        createdAt: d.created_at,
        score: hit._score ?? null,
        highlight: {
          title: hit.highlight?.title?.[0],
          description: hit.highlight?.description?.[0],
          host: hit.highlight?.['host.parts']?.[0],
        },
      };
    }),
    facets: {
      severity: counts(response.aggregations!.by_severity.buckets),
      category: counts(response.aggregations!.by_category.buckets),
    },
    meta: { page: params.page, pageSize: params.pageSize, total, totalPages: Math.ceil(total / params.pageSize) },
  };
}
