import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { BatchProgress, ScanProgress } from './scan-job.types';

/**
 * Socket.IO namespace /scans. Server -> client events:
 *   "scan.progress"   one job moved to a new stage (queued, scanning, saving, indexing, retrying, completed, failed)
 *   "batch.progress"  a job in a batch finished; totals for the whole batch
 *
 * Every connected client gets every event (fine for one dashboard). With many tenants you would put
 * clients in rooms (e.g. per batch or per organisation) and emit to rooms only.
 */
@WebSocketGateway({ namespace: '/scans' })
export class ScanEventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ScanEventsGateway.name);

  @WebSocketServer()
  private readonly namespace: Namespace;

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  publishScanProgress(progress: ScanProgress): void {
    this.namespace.emit('scan.progress', progress);
  }

  publishBatchProgress(batch: BatchProgress): void {
    this.namespace.emit('batch.progress', batch);
  }
}
