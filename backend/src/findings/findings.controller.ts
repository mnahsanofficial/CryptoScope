import { Controller, Get, Query } from '@nestjs/common';
import { Paginated } from '../common/pagination';
import { ListFindingsQueryDto } from './dto/list-findings.query';
import { Finding } from './finding.entity';
import { FindingsService } from './findings.service';

@Controller('findings')
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  // GET /api/findings?severity=critical&sort=createdAt&order=desc&page=1&pageSize=20
  @Get()
  list(@Query() query: ListFindingsQueryDto): Promise<Paginated<Finding>> {
    return this.findings.list(query);
  }
}
