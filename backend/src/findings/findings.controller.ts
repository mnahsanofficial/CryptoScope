import { Controller, Get, Query } from '@nestjs/common';
import { Paginated } from '../common/pagination';
import { ListFindingsQueryDto } from './dto/list-findings.query';
import { SearchFindingsQueryDto } from './dto/search-findings.query';
import { Finding } from './finding.entity';
import { FindingsSearchService } from './findings-search.service';
import { FindingsService } from './findings.service';

@Controller('findings')
export class FindingsController {
  constructor(
    private readonly findings: FindingsService,
    private readonly search: FindingsSearchService,
  ) {}

  // GET /api/findings?severity=critical&sort=createdAt&order=desc&page=1&pageSize=20
  @Get()
  list(@Query() query: ListFindingsQueryDto): Promise<Paginated<Finding>> {
    return this.findings.list(query);
  }

  // GET /api/findings/search?q=zeuz&severity=critical&currentOnly=true
  // Full-text search (Elasticsearch): relevance-ranked, typo-tolerant, highlighted, with severity/category counts.
  @Get('search')
  searchFindings(@Query() query: SearchFindingsQueryDto) {
    return this.search.search(query);
  }
}
