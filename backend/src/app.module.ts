import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsModule } from './analytics/analytics.module';
import { AssetsModule } from './assets/assets.module';
import { AuthModule } from './auth/auth.module';
import { CryptoAgilityModule } from './crypto-agility/crypto-agility.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { AppConfig, loadConfig } from './config/configuration';
import { buildTypeOrmOptions } from './database/typeorm-options';
import { FindingsModule } from './findings/findings.module';
import { ElasticsearchModule } from './infra/elasticsearch.module';
import { RedisModule } from './infra/redis.module';
import { HealthModule } from './health/health.module';
import { RiskModule } from './risk/risk.module';
import { ScannerModule } from './scanner/scanner.module';
import { ScanJobsModule } from './scan-jobs/scan-jobs.module';
import { ScansModule } from './scans/scans.module';
import { UsersModule } from './users/users.module';

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
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: config.getOrThrow<AppConfig['redis']>('redis'),
        prefix: config.getOrThrow<AppConfig['queue']>('queue').prefix,
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { rateLimit } = config.getOrThrow<AppConfig['security']>('security');
        const redis = config.getOrThrow<AppConfig['redis']>('redis');
        const { prefix } = config.getOrThrow<AppConfig['queue']>('queue');
        return {
          throttlers: [{ name: 'default', limit: rateLimit.limit, ttl: rateLimit.ttlMs }],
          // Counters live in Redis, so the limit holds across several API instances.
          storage: new ThrottlerStorageRedisService({ ...redis, keyPrefix: `${prefix}:throttle:` }),
        };
      },
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
    ScanJobsModule,
    UsersModule,
    AuthModule,
    DashboardModule,
    CryptoAgilityModule,
  ],
  // Global guards run in this order for every request:
  // 1. rate limit (before auth, so password guessing is throttled too)
  // 2. authentication: valid JWT required unless the route is @Public()
  // 3. authorisation: @Roles('admin') routes need the admin role
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
