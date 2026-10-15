import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import {
  SearchHandshakesQueryDto,
  TimeRangeQueryDto,
  TopHostsQueryDto,
  WeakPerIntervalQueryDto,
} from './dto/analytics-query.dto';

/** Aggregations over TLS handshake logs in Elasticsearch. All endpoints accept ?from=&to= (ISO 8601). */
@Controller('analytics/handshakes')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  // GET /api/analytics/handshakes/key-algorithms
  @Get('key-algorithms')
  keyAlgorithms(@Query() query: TimeRangeQueryDto) {
    return this.analytics.keyAlgorithmCounts(query);
  }

  // GET /api/analytics/handshakes/weak-per-interval?interval=1h
  @Get('weak-per-interval')
  weakPerInterval(@Query() query: WeakPerIntervalQueryDto) {
    return this.analytics.weakPerInterval(query);
  }

  // GET /api/analytics/handshakes/top-weak-rsa-hosts?limit=10
  @Get('top-weak-rsa-hosts')
  topWeakRsaHosts(@Query() query: TopHostsQueryDto) {
    return this.analytics.topWeakRsaHosts(query);
  }

  // GET /api/analytics/handshakes/quantum-vulnerable
  @Get('quantum-vulnerable')
  quantumVulnerable(@Query() query: TimeRangeQueryDto) {
    return this.analytics.quantumVulnerableShare(query);
  }

  // GET /api/analytics/handshakes/search?q=msie&tlsVersion=TLSv1
  @Get('search')
  search(@Query() query: SearchHandshakesQueryDto) {
    return this.analytics.searchHandshakes(query);
  }
}
