import { Test } from '@nestjs/testing';
import { Client } from '@elastic/elasticsearch';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../infra/redis.module';
import { HEALTH_CHECK_TIMEOUT_MS, HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const dataSource = { query: jest.fn() };
  const redis = { ping: jest.fn() };
  const elasticsearch = { cluster: { health: jest.fn() } };

  beforeEach(async () => {
    jest.resetAllMocks();
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');
    elasticsearch.cluster.health.mockResolvedValue({ status: 'yellow' });

    // Replace real connections with fakes so the test needs no running infrastructure.
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: Client, useValue: elasticsearch },
      ],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('liveness returns ok without touching dependencies', () => {
    expect(service.liveness().status).toBe('ok');
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('reports ok when every dependency is up', async () => {
    const report = await service.readiness();

    expect(report.status).toBe('ok');
    expect(report.checks.postgres.status).toBe('up');
    expect(report.checks.redis.status).toBe('up');
    expect(report.checks.elasticsearch).toMatchObject({ status: 'up', details: 'cluster status yellow' });
  });

  it('reports error when one dependency fails, and keeps the others up', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const report = await service.readiness();

    expect(report.status).toBe('error');
    expect(report.checks.redis).toMatchObject({ status: 'down', error: 'ECONNREFUSED' });
    expect(report.checks.postgres.status).toBe('up');
  });

  it('treats a red Elasticsearch cluster as down', async () => {
    elasticsearch.cluster.health.mockResolvedValue({ status: 'red' });

    const report = await service.readiness();

    expect(report.checks.elasticsearch).toMatchObject({ status: 'down', error: 'Cluster status is red' });
  });

  it('marks a hanging dependency as down after the timeout', async () => {
    jest.useFakeTimers();
    dataSource.query.mockReturnValue(new Promise(() => undefined)); // never settles

    const pending = service.readiness();
    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);
    const report = await pending;

    expect(report.checks.postgres).toMatchObject({
      status: 'down',
      error: `Timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`,
    });
  });
});
