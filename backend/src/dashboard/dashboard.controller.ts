import { Controller, Get, Query } from '@nestjs/common';
import { Paginated } from '../common/pagination';
import { ExpiringCertificatesQueryDto } from './dashboard.dto';
import { DashboardService, ExpiringCertificate, Overview } from './dashboard.service';

/** Read-only summaries for the dashboard. Any signed-in user. */
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  // GET /api/dashboard/overview
  @Get('dashboard/overview')
  overview(): Promise<Overview> {
    return this.dashboard.overview();
  }

  // GET /api/certificates/expiring?days=30&includeExpired=true&page=1&pageSize=20
  @Get('certificates/expiring')
  expiring(@Query() query: ExpiringCertificatesQueryDto): Promise<Paginated<ExpiringCertificate>> {
    return this.dashboard.expiringCertificates(query);
  }
}
