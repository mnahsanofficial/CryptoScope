import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService, HANDSHAKE_INDEX } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    {
      provide: HANDSHAKE_INDEX,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow<AppConfig['elasticsearch']>('elasticsearch').handshakeIndex,
    },
  ],
})
export class AnalyticsModule {}
