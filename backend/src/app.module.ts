import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig, loadConfig } from './config/configuration';
import { ElasticsearchModule } from './infra/elasticsearch.module';
import { RedisModule } from './infra/redis.module';
import { HealthModule } from './health/health.module';
import { RiskModule } from './risk/risk.module';
import { ScannerModule } from './scanner/scanner.module';

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
      useFactory: (config: ConfigService) => {
        const db = config.getOrThrow<AppConfig['database']>('database');
        return {
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.name,
          autoLoadEntities: true,
          // Never auto-sync the schema; we will use migrations in Step 4.
          synchronize: false,
        };
      },
    }),
    RedisModule,
    ElasticsearchModule,
    HealthModule,
    ScannerModule,
    RiskModule,
  ],
})
export class AppModule {}
