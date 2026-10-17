import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Client, errors } from '@elastic/elasticsearch';
import { MAX_RESULT_WINDOW } from '../analytics/dto/analytics-query.dto';
import { SearchFindingsQueryDto } from './dto/search-findings.query';
import { FindingDocument } from './findings-index';
import { FINDINGS_INDEX } from './findings-indexer.service';
import { buildFindingsSearch, FindingsSearchAggs, mapFindingsSearch } from './findings-search';

/** Full-text search over findings in Elasticsearch (the listing without text stays in PostgreSQL). */
@Injectable()
export class FindingsSearchService {
  private readonly logger = new Logger(FindingsSearchService.name);

  constructor(
    private readonly es: Client,
    @Inject(FINDINGS_INDEX) private readonly alias: string,
  ) {}

  async search(query: SearchFindingsQueryDto) {
    if (query.page * query.pageSize > MAX_RESULT_WINDOW) {
      throw new BadRequestException(`page * pageSize must be at most ${MAX_RESULT_WINDOW}`);
    }
    try {
      const response = await this.es.search<FindingDocument, FindingsSearchAggs>({ ...buildFindingsSearch(query), index: this.alias });
      return mapFindingsSearch(response, query);
    } catch (err) {
      if (err instanceof errors.ResponseError && err.statusCode === 404) {
        throw new NotFoundException(`Findings search index "${this.alias}" not found. Run: npm run findings:reindex`);
      }
      if (err instanceof errors.ConnectionError || err instanceof errors.TimeoutError) {
        this.logger.error(`Elasticsearch unavailable: ${err.message}`);
        throw new ServiceUnavailableException('Search is unavailable (Elasticsearch)');
      }
      throw err;
    }
  }
}
