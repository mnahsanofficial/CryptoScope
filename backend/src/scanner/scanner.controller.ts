import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ScanRequestDto } from './dto/scan-request.dto';
import { SEED_TARGETS } from './seed-targets';
import { ScanOutcome } from './scanner.types';
import { TlsScannerService } from './tls-scanner.service';

export interface ScanResponse {
  summary: { total: number; succeeded: number; failed: number; durationMs: number };
  outcomes: ScanOutcome[];
}

@Controller('scanner')
export class ScannerController {
  constructor(private readonly scanner: TlsScannerService) {}

  // GET /api/scanner/seed-targets
  @Get('seed-targets')
  seedTargets(): readonly string[] {
    return SEED_TARGETS;
  }

  // POST /api/scanner/scan  { "targets": ["github.com", ...] }
  // Synchronous for now; Step 6 moves scanning to a BullMQ background job.
  @Post('scan')
  @HttpCode(200)
  async scan(@Body() body: ScanRequestDto): Promise<ScanResponse> {
    const started = Date.now();
    const outcomes = await this.scanner.scanMany(body.targets);
    const succeeded = outcomes.filter((o) => o.status === 'success').length;

    return {
      summary: {
        total: outcomes.length,
        succeeded,
        failed: outcomes.length - succeeded,
        durationMs: Date.now() - started,
      },
      outcomes,
    };
  }
}
