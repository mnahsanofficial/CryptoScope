import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import { Roles } from '../auth/decorators';
import { ScanQueueService } from './scan-queue.service';

export class EnqueueBatchDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  assetIds: string[];
}

/**
 * Scans run in the background. These endpoints only create jobs (202 Accepted) and report on them;
 * live progress is pushed over Socket.IO (namespace /scans).
 */
@Controller()
export class ScanJobsController {
  constructor(private readonly queue: ScanQueueService) {}

  // POST /api/assets/:assetId/scans  -> 202 { jobId, scanId, created }
  @Post('assets/:assetId/scans')
  @Roles('admin')
  @HttpCode(202)
  scanAsset(@Param('assetId', ParseUUIDPipe) assetId: string) {
    return this.queue.enqueueAsset(assetId);
  }

  // POST /api/scan-jobs  { "assetIds": [...] }  -> 202 { batchId, total, jobs }
  @Post('scan-jobs')
  @Roles('admin')
  @HttpCode(202)
  scanMany(@Body() body: EnqueueBatchDto) {
    return this.queue.enqueueBatch(body.assetIds);
  }

  // GET /api/scan-jobs  -> job counts by state (waiting, active, delayed, completed, failed)
  @Get('scan-jobs')
  counts() {
    return this.queue.counts();
  }

  // GET /api/scan-jobs/batches/:batchId  -> { total, completed, failed, percent }
  @Get('scan-jobs/batches/:batchId')
  batch(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.queue.getBatch(batchId);
  }

  // GET /api/scan-jobs/:jobId  -> state, progress, attempts, result or failure reason
  @Get('scan-jobs/:jobId')
  job(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.queue.getJob(jobId);
  }
}
