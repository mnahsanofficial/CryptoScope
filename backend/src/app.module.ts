import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsModule } from './analytics/analytics.module';
import { AssetsModule } from './assets/assets.module';
import { AppConfig, loadConfig } from './config/configuration';
import { buildTypeOrmOptions } from './database/typeorm-options';
import { FindingsModule } from './findings/findings.module';
import { ElasticsearchModule } from './infra/elasticsearch.module';
import { RedisModule } from './infra/redis.module';
import { HealthModule } from './health/health.module';
import { RiskModule } from './risk/risk.module';
import { ScannerModule } from './scanner/scanner.module';
import { ScansModule } from './scans/scans.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Look for .env in backend/ first, then the monorepo root (for local `npm run start:dev`).
      envFilePath: ['.env', '../.env'],
      load: [() => loadConfig()],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildTypeOrmOptions(config.getOrThrow<AppConfig['database']>('database')),
        // Apply pending migrations on startup, so `docker compose up` always gets the current schema.
        migrationsRun: true,
      }),
    }),
    RedisModule,
    ElasticsearchModule,
    HealthModule,
    ScannerModule,
    RiskModule,
    AssetsModule,
    ScansModule,
    FindingsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
