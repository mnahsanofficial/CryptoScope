import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfiguredSocketIoAdapter } from './scan-jobs/socket-io.adapter';

/** Shared by main.ts and the e2e tests, so tests run against exactly the same app configuration. */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  // Validate every request body/query against its DTO; reject unknown fields instead of silently passing them on.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: config.getOrThrow<string>('frontendUrl') });
  app.useWebSocketAdapter(new ConfiguredSocketIoAdapter(app));
  // Lets modules close DB/Redis/ES connections cleanly on SIGTERM (e.g. `docker compose down`).
  app.enableShutdownHooks();
}
