import { loadConfig } from './configuration';

const validEnv: NodeJS.ProcessEnv = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5433',
  POSTGRES_USER: 'cryptoscope',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_DB: 'cryptoscope',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  ELASTICSEARCH_NODE: 'http://localhost:9200',
};

describe('loadConfig', () => {
  it('builds a typed config with defaults', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3001);
    expect(config.database.port).toBe(5433);
    expect(config.redis.port).toBe(6379);
  });

  it('fails fast when a required variable is missing', () => {
    const { POSTGRES_PASSWORD: _omit, ...env } = validEnv;

    expect(() => loadConfig(env)).toThrow('Missing required environment variable: POSTGRES_PASSWORD');
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...validEnv, REDIS_PORT: 'abc' })).toThrow('REDIS_PORT must be a valid port');
  });
});
