import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter that takes its CORS origin from config.
 * (A @WebSocketGateway decorator is evaluated when the file loads, before config exists.)
 */
export class ConfiguredSocketIoAdapter extends IoAdapter {
  private readonly origin: string;

  constructor(app: INestApplicationContext) {
    super(app);
    this.origin = app.get(ConfigService).getOrThrow<string>('frontendUrl');
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    return super.createIOServer(port, { ...options, cors: { origin: this.origin } });
  }
}
