import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppConfig } from './config/configuration';
import { ConfiguredSocketIoAdapter } from './scan-jobs/socket-io.adapter';

/** Shared by main.ts and the e2e tests, so tests run against exactly the same app configuration. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const { trustProxyHops } = config.getOrThrow<AppConfig['security']>('security');

  // Security headers: no MIME sniffing, no framing (clickjacking), HSTS, a strict CSP, no X-Powered-By, ...
  app.use(helmet());
  // Behind a load balancer, req.ip would be the balancer's IP and every user would share one rate limit.
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);
  // Reject oversized bodies early (the largest legitimate body is a batch of 1000 asset ids).
  app.useBodyParser('json', { limit: '100kb' });

  app.setGlobalPrefix('api');
  // Validate every request body/query against its DTO; reject unknown fields instead of silently passing them on.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: config.getOrThrow<string>('frontendUrl') });
  app.useWebSocketAdapter(new ConfiguredSocketIoAdapter(app));
  // Lets modules close DB/Redis/ES connections cleanly on SIGTERM (e.g. `docker compose down`).
  app.enableShutdownHooks();
}
