import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService, ReadinessReport } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // GET /api/health — used by Docker's healthcheck
  @Get()
  liveness() {
    return this.health.liveness();
  }

  // GET /api/health/ready — 200 when all dependencies are up, 503 otherwise
  @Get('ready')
  async readiness(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
