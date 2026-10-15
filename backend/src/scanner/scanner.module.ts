import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { ScannerController } from './scanner.controller';
import { SCANNER_OPTIONS, ScannerOptions, TlsScannerService } from './tls-scanner.service';

@Module({
  controllers: [ScannerController],
  providers: [
    TlsScannerService,
    {
      provide: SCANNER_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ScannerOptions => {
        const { timeoutMs, concurrency } = config.getOrThrow<AppConfig['scanner']>('scanner');
        return { timeoutMs, concurrency, probePostQuantum: true };
      },
    },
  ],
  exports: [TlsScannerService],
})
export class ScannerModule {}
