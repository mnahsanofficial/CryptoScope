import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { BatchProgress, ScanProgress } from './scan-job.types';

/**
 * Socket.IO namespace /scans. Server -> client events:
 *   "scan.progress"   one job moved to a new stage (queued, scanning, saving, indexing, retrying, completed, failed)
 *   "batch.progress"  a job in a batch finished; totals for the whole batch
 *
 * Clients must send a valid JWT when connecting:  io(url + '/scans', { auth: { token } })
 * Any role may listen (viewers can watch scans; only admins can start them).
 *
 * Every connected client gets every event (fine for one dashboard). With many tenants you would put
 * clients in rooms (e.g. per batch or per organisation) and emit to rooms only.
 */
@WebSocketGateway({ namespace: '/scans' })
export class ScanEventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ScanEventsGateway.name);

  @WebSocketServer()
  private readonly namespace: Namespace;

  constructor(private readonly auth: AuthService) {}

  /** Socket.IO middleware: runs once per connection attempt, before "connection". */
  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown })?.token;
      if (typeof token !== 'string' || !token) {
        next(new Error('Unauthorized: missing token'));
        return;
      }
      this.auth
        .verify(token)
        .then((user) => {
          socket.data.user = user;
          next();
        })
        .catch(() => next(new Error('Unauthorized: invalid or expired token')));
    });
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id} (${(client.data.user as { email?: string })?.email})`);
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
