import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { RiskEngine } from '../risk/risk-engine';
import { RiskAssessment, RiskLevel } from '../risk/risk.types';
import { ScanRequestDto } from './dto/scan-request.dto';
import { SEED_TARGETS } from './seed-targets';
import { ScanOutcome } from './scanner.types';
import { TlsScannerService } from './tls-scanner.service';

/** A successful scan carries its risk assessment; a failed scan has nothing to assess. */
export type AssessedScanOutcome =
  | (Extract<ScanOutcome, { status: 'success' }> & { risk: RiskAssessment })
  | Extract<ScanOutcome, { status: 'failed' }>;

export interface ScanResponse {
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    durationMs: number;
    /** Average risk score of the successfully scanned targets (null if none succeeded). */
    averageRiskScore: number | null;
    byRiskLevel: Record<RiskLevel, number>;
  };
  outcomes: AssessedScanOutcome[];
}

@Controller('scanner')
export class ScannerController {
  constructor(
    private readonly scanner: TlsScannerService,
    private readonly riskEngine: RiskEngine,
  ) {}

  // GET /api/scanner/seed-targets
  @Get('seed-targets')
  seedTargets(): readonly string[] {
    return SEED_TARGETS;
  }

  // POST /api/scanner/scan  { "targets": ["github.com", ...] }
  // Synchronous for now; Step 6 moves scanning to a BullMQ background job.
  @Post('scan')
  @Roles('admin') // connects to arbitrary hosts: admin only, and SSRF-protected in the scanner
  @HttpCode(200)
  async scan(@Body() body: ScanRequestDto): Promise<ScanResponse> {
    const started = Date.now();
    const scanned = await this.scanner.scanMany(body.targets);
    const outcomes = scanned.map((outcome): AssessedScanOutcome =>
      outcome.status === 'success' ? { ...outcome, risk: this.riskEngine.assess(outcome.result) } : outcome,
    );
    return { summary: summarise(outcomes, Date.now() - started), outcomes };
  }
}

function summarise(outcomes: AssessedScanOutcome[], durationMs: number): ScanResponse['summary'] {
  const byRiskLevel: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };
  const scores: number[] = [];

  for (const outcome of outcomes) {
    if (outcome.status !== 'success') continue;
    byRiskLevel[outcome.risk.level]++;
    scores.push(outcome.risk.score);
  }

  return {
    total: outcomes.length,
    succeeded: scores.length,
    failed: outcomes.length - scores.length,
    durationMs,
    averageRiskScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    byRiskLevel,
  };
}
