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
  JWT_SECRET: 'x'.repeat(32),
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

  it('requires a JWT secret of at least 32 characters', () => {
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: 'short' })).toThrow('at least 32 characters');
    const { JWT_SECRET: _omit, ...env } = validEnv;
    expect(() => loadConfig(env)).toThrow('Missing required environment variable: JWT_SECRET');
  });

  it('bootstrap admin needs both email and password', () => {
    expect(loadConfig(validEnv).auth.bootstrapAdmin).toBeNull();
    expect(() => loadConfig({ ...validEnv, ADMIN_EMAIL: 'a@b.c' })).toThrow('ADMIN_EMAIL and ADMIN_PASSWORD');
  });

  it('keeps SSRF protection on unless explicitly disabled', () => {
    expect(loadConfig(validEnv).scanner.allowPrivateTargets).toBe(false);
    expect(loadConfig({ ...validEnv, SCAN_ALLOW_PRIVATE_TARGETS: 'true' }).scanner.allowPrivateTargets).toBe(true);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...validEnv, REDIS_PORT: 'abc' })).toThrow('REDIS_PORT must be a valid port');
  });
});
