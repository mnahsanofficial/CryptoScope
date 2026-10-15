import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client, errors, estypes } from '@elastic/elasticsearch';
import { HandshakeLog } from './handshake-index';
import {
  KeyAlgorithmAggs,
  mapKeyAlgorithmCounts,
  mapQuantumVulnerableShare,
  mapSearch,
  mapTopWeakRsaHosts,
  mapWeakPerInterval,
  QuantumVulnerableAggs,
  TopWeakRsaHostsAggs,
  WeakPerIntervalAggs,
} from './handshake-mappers';
import {
  buildKeyAlgorithmCounts,
  buildQuantumVulnerableShare,
  buildSearch,
  buildTopWeakRsaHosts,
  buildWeakPerInterval,
  TimeRange,
} from './handshake-queries';
import {
  MAX_RESULT_WINDOW,
  SearchHandshakesQueryDto,
  TimeRangeQueryDto,
  TopHostsQueryDto,
  WeakPerIntervalQueryDto,
} from './dto/analytics-query.dto';

export const HANDSHAKE_INDEX = Symbol('HANDSHAKE_INDEX');

/**
 * Default window: the last 7 days, rounded down to the hour ("/h").
 * Rounding keeps the query identical for a whole hour, which helps Elasticsearch's caches.
 */
const DEFAULT_RANGE: TimeRange = { from: 'now-7d/h', to: 'now' };

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly es: Client,
    @Inject(HANDSHAKE_INDEX) private readonly index: string,
  ) {}

  async keyAlgorithmCounts(query: TimeRangeQueryDto) {
    const response = await this.search<unknown, KeyAlgorithmAggs>(buildKeyAlgorithmCounts(this.range(query)));
    return mapKeyAlgorithmCounts(response);
  }

  async weakPerInterval(query: WeakPerIntervalQueryDto) {
    const response = await this.search<unknown, WeakPerIntervalAggs>(
      buildWeakPerInterval(this.range(query), query.interval),
    );
    return mapWeakPerInterval(response, query.interval);
  }

  async topWeakRsaHosts(query: TopHostsQueryDto) {
    const response = await this.search<unknown, TopWeakRsaHostsAggs>(buildTopWeakRsaHosts(this.range(query), query.limit));
    return mapTopWeakRsaHosts(response);
  }

  async quantumVulnerableShare(query: TimeRangeQueryDto) {
    const response = await this.search<unknown, QuantumVulnerableAggs>(buildQuantumVulnerableShare(this.range(query)));
    return mapQuantumVulnerableShare(response);
  }

  async searchHandshakes(query: SearchHandshakesQueryDto) {
    if (query.page * query.pageSize > MAX_RESULT_WINDOW) {
      // Deep paging with from/size gets expensive; real infinite scroll would use search_after.
      throw new BadRequestException(`page * pageSize must be at most ${MAX_RESULT_WINDOW}`);
    }
    const response = await this.search<HandshakeLog>(buildSearch(this.range(query), query));
    return mapSearch(response, query.page, query.pageSize);
  }

  private range({ from, to }: TimeRangeQueryDto): TimeRange {
    const range = { from: from ?? DEFAULT_RANGE.from, to: to ?? DEFAULT_RANGE.to };
    if (from && to && new Date(from) >= new Date(to)) {
      throw new BadRequestException('"from" must be before "to"');
    }
    return range;
  }

  /** Runs a search against the handshake alias and turns Elasticsearch errors into clear HTTP errors. */
  private async search<TDoc, TAggs = Record<string, estypes.AggregationsAggregate>>(
    request: estypes.SearchRequest,
  ): Promise<estypes.SearchResponse<TDoc, TAggs>> {
    try {
      return await this.es.search<TDoc, TAggs>({ ...request, index: this.index });
    } catch (err) {
      if (err instanceof errors.ResponseError && err.statusCode === 404) {
        throw new NotFoundException(`No handshake logs found (index "${this.index}"). Run: npm run logs:generate`);
      }
      if (err instanceof errors.ConnectionError || err instanceof errors.TimeoutError) {
        this.logger.error(`Elasticsearch unavailable: ${err.message}`);
        throw new ServiceUnavailableException('Elasticsearch is unavailable');
      }
      throw err;
    }
  }
}
