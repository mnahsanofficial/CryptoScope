import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  // Validate every request body against its DTO; reject unknown fields instead of silently passing them on.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: config.getOrThrow<string>('frontendUrl') });
  // Lets modules close DB/Redis/ES connections cleanly on SIGTERM (e.g. `docker compose down`).
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('port');
  await app.listen(port, '0.0.0.0');
  Logger.log(`CryptoScope API listening on http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
