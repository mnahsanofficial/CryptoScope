import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { HealthService, ReadinessReport } from './health.service';

// Probes (Docker, Kubernetes, load balancers) call these without a token, every few seconds.
@Public()
@SkipThrottle()
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
