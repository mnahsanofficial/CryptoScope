import { RiskEngine } from '../risk/risk-engine';
import { makeScan, RSA_2048 } from '../risk/testing/make-scan';
import { ScannerController } from './scanner.controller';
import { ScanOutcome } from './scanner.types';
import { TlsScannerService } from './tls-scanner.service';

describe('ScannerController', () => {
  const ideal = makeScan();
  const classical = makeScan({ certificate: { ...RSA_2048 }, tls: { postQuantumKeyExchange: false } });

  const outcomes: ScanOutcome[] = [
    { target: ideal.target, status: 'success', result: ideal },
    { target: classical.target, status: 'success', result: classical },
    { target: { host: 'down.test', port: 443 }, status: 'failed', error: { code: 'TIMEOUT', message: 'slow' } },
  ];

  const scanner = { scanMany: jest.fn().mockResolvedValue(outcomes) } as unknown as TlsScannerService;
  const controller = new ScannerController(scanner, new RiskEngine());

  it('attaches a risk assessment to successful scans only', async () => {
    const response = await controller.scan({ targets: ['a', 'b', 'c'] });

    const [first, second, third] = response.outcomes;
    expect(first.status === 'success' && first.risk.level).toBe('none');
    expect(second.status === 'success' && second.risk.score).toBe(20);
    expect(third).not.toHaveProperty('risk');
  });

  it('summarises counts, average score and risk levels', async () => {
    const { summary } = await controller.scan({ targets: ['a', 'b', 'c'] });

    expect(summary).toMatchObject({
      total: 3,
      succeeded: 2,
      failed: 1,
      averageRiskScore: 10, // (0 + 20) / 2
      byRiskLevel: { critical: 0, high: 0, medium: 1, low: 0, none: 1 },
    });
  });
});
