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
    },
  };
}
