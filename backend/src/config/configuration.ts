export interface AppConfig {
  port: number;
  frontendUrl: string;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
  };
  redis: {
    host: string;
    port: number;
  };
  elasticsearch: {
    node: string;
    /** Alias the handshake-log analytics read from (points at a versioned index). */
    handshakeIndex: string;
    /** Index the scan worker writes findings to (a search/read copy of the Postgres findings). */
    findingsIndex: string;
  };
  scanner: {
    timeoutMs: number;
    concurrency: number;
  };
  queue: {
    /** Redis key prefix for BullMQ. Different prefixes = fully separate queues (used by the e2e tests). */
    prefix: string;
    /** Scan jobs processed at the same time by this process. */
    workerConcurrency: number;
    /** Total tries per scan job (1 = no retries). */
    scanAttempts: number;
    /** First retry delay; doubles each time (exponential backoff). */
    retryDelayMs: number;
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function toPort(value: string, key: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Environment variable ${key} must be a valid port, got "${value}"`);
  }
  return port;
}

function toPositiveInt(value: string, key: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Environment variable ${key} must be a positive integer, got "${value}"`);
  }
  return n;
}

/**
 * Builds a typed config object from environment variables.
 * Fails fast at startup so a misconfigured container crashes immediately
 * instead of failing later on the first request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: toPort(env.BACKEND_PORT ?? '3001', 'BACKEND_PORT'),
    frontendUrl: env.FRONTEND_URL ?? 'http://localhost:3000',
    database: {
      host: required(env, 'POSTGRES_HOST'),
      port: toPort(required(env, 'POSTGRES_PORT'), 'POSTGRES_PORT'),
      username: required(env, 'POSTGRES_USER'),
      password: required(env, 'POSTGRES_PASSWORD'),
      name: required(env, 'POSTGRES_DB'),
    },
    redis: {
      host: required(env, 'REDIS_HOST'),
      port: toPort(required(env, 'REDIS_PORT'), 'REDIS_PORT'),
    },
    elasticsearch: {
      node: required(env, 'ELASTICSEARCH_NODE'),
      handshakeIndex: env.HANDSHAKE_INDEX ?? 'tls-handshakes',
      findingsIndex: env.FINDINGS_INDEX ?? 'cryptoscope-findings',
    },
    scanner: {
      timeoutMs: toPositiveInt(env.SCAN_TIMEOUT_MS ?? '5000', 'SCAN_TIMEOUT_MS'),
      concurrency: toPositiveInt(env.SCAN_CONCURRENCY ?? '10', 'SCAN_CONCURRENCY'),
    },
    queue: {
      prefix: env.QUEUE_PREFIX ?? 'cryptoscope',
      workerConcurrency: toPositiveInt(env.SCAN_WORKER_CONCURRENCY ?? '5', 'SCAN_WORKER_CONCURRENCY'),
      scanAttempts: toPositiveInt(env.SCAN_JOB_ATTEMPTS ?? '3', 'SCAN_JOB_ATTEMPTS'),
      retryDelayMs: toPositiveInt(env.SCAN_RETRY_DELAY_MS ?? '2000', 'SCAN_RETRY_DELAY_MS'),
    },
  };
}
