import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Finding } from './finding.entity';
import { FindingsController } from './findings.controller';
import { FINDINGS_INDEX, FindingsIndexer } from './findings-indexer.service';
import { FindingsSearchService } from './findings-search.service';
import { FindingsService } from './findings.service';

@Module({
  imports: [TypeOrmModule.forFeature([Finding])],
  controllers: [FindingsController],
  providers: [
    FindingsService,
    FindingsIndexer,
    FindingsSearchService,
    {
      provide: FINDINGS_INDEX,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow<AppConfig['elasticsearch']>('elasticsearch').findingsIndex,
    },
  ],
  exports: [FindingsIndexer],
})
export class FindingsModule {}
