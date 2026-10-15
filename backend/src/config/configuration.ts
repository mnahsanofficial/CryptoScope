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
    /** Allow scanning private/loopback/link-local addresses. Off by default: SSRF protection. */
    allowPrivateTargets: boolean;
  };
  auth: {
    jwtSecret: string;
    /** e.g. "1h", "15m". Short-lived tokens limit the damage of a leaked token. */
    jwtExpiresIn: string;
    /** Optional: creates this admin on startup if no users exist yet. */
    bootstrapAdmin: { email: string; password: string } | null;
  };
  security: {
    /** Requests allowed per client IP per window (global default). */
    rateLimit: { limit: number; ttlMs: number };
    /** Trust X-Forwarded-For from this many proxy hops (needed behind a load balancer). 0 = off. */
    trustProxyHops: number;
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

const MIN_JWT_SECRET_LENGTH = 32;

function jwtSecret(env: NodeJS.ProcessEnv): string {
  const secret = required(env, 'JWT_SECRET');
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters (try: openssl rand -base64 48)`);
  }
  return secret;
}

function bootstrapAdmin(env: NodeJS.ProcessEnv): AppConfig['auth']['bootstrapAdmin'] {
  const email = env.ADMIN_EMAIL?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!email && !password) return null;
  if (!email || !password) throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD, or neither');
  return { email, password };
}

const toBool = (value: string | undefined): boolean => value === 'true' || value === '1';

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
      allowPrivateTargets: toBool(env.SCAN_ALLOW_PRIVATE_TARGETS),
    },
    auth: {
      jwtSecret: jwtSecret(env),
      jwtExpiresIn: env.JWT_EXPIRES_IN ?? '1h',
      bootstrapAdmin: bootstrapAdmin(env),
    },
    security: {
      rateLimit: {
        limit: toPositiveInt(env.RATE_LIMIT ?? '100', 'RATE_LIMIT'),
        ttlMs: toPositiveInt(env.RATE_LIMIT_TTL_MS ?? '60000', 'RATE_LIMIT_TTL_MS'),
      },
      trustProxyHops: Number(env.TRUST_PROXY_HOPS ?? '0'),
    },
    queue: {
      prefix: env.QUEUE_PREFIX ?? 'cryptoscope',
      workerConcurrency: toPositiveInt(env.SCAN_WORKER_CONCURRENCY ?? '5', 'SCAN_WORKER_CONCURRENCY'),
      scanAttempts: toPositiveInt(env.SCAN_JOB_ATTEMPTS ?? '3', 'SCAN_JOB_ATTEMPTS'),
      retryDelayMs: toPositiveInt(env.SCAN_RETRY_DELAY_MS ?? '2000', 'SCAN_RETRY_DELAY_MS'),
    },
  };
}
