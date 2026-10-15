import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = app.get(ConfigService).getOrThrow<number>('port');
  await app.listen(port, '0.0.0.0');
  Logger.log(`CryptoScope API listening on http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
