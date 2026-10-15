import { Logger } from '@nestjs/common';
import { OnQueueEvent, QueueEventsHost, QueueEventsListener } from '@nestjs/bullmq';
import { isScanProgress, SCAN_QUEUE } from './scan-job.types';
import { ScanEventsGateway } from './scan-events.gateway';

/**
 * Bridges BullMQ -> Socket.IO.
 *
 * Workers report progress with job.updateProgress(). BullMQ publishes that through a Redis stream,
 * and this listener (one per API process) forwards it to the process's Socket.IO clients.
 * Because the bridge goes through Redis, a worker in another process or container still reaches
 * every browser, no matter which API instance it is connected to.
 */
@QueueEventsListener(SCAN_QUEUE)
export class ScanQueueEventsListener extends QueueEventsHost {
  private readonly logger = new Logger(ScanQueueEventsListener.name);

  constructor(private readonly gateway: ScanEventsGateway) {
    super();
  }

  @OnQueueEvent('progress')
  onProgress({ jobId, data }: { jobId: string; data: unknown }): void {
    if (!isScanProgress(data)) return;
    this.gateway.publishScanProgress({ ...data, jobId });
    if (data.batch) this.gateway.publishBatchProgress(data.batch);
  }

  @OnQueueEvent('failed')
  onFailed({ jobId, failedReason }: { jobId: string; failedReason: string }): void {
    this.logger.warn(`Scan job ${jobId} failed for good: ${failedReason}`);
  }
}
