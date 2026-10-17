import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from '../assets/asset.entity';
import { FindingsModule } from '../findings/findings.module';
import { ScannerModule } from '../scanner/scanner.module';
import { ScansModule } from '../scans/scans.module';
import { BatchTracker } from './batch-tracker.service';
import { SCAN_QUEUE } from './scan-job.types';
import { ScanEventsGateway } from './scan-events.gateway';
import { ScanJobsController } from './scan-jobs.controller';
import { ScanQueueEventsListener } from './scan-queue-events.listener';
import { ScanQueueService } from './scan-queue.service';
import { ScanProcessor } from './scan.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: SCAN_QUEUE }),
    TypeOrmModule.forFeature([Asset]),
    ScannerModule,
    ScansModule,
    FindingsModule,
  ],
  controllers: [ScanJobsController],
  providers: [ScanQueueService, BatchTracker, ScanProcessor, ScanEventsGateway, ScanQueueEventsListener],
  exports: [ScanQueueService],
})
export class ScanJobsModule {}
