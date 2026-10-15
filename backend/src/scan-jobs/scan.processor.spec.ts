import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { makeScan } from '../risk/testing/make-scan';
import { ScanError } from '../scanner/scan-error';
import { ScanJobData, ScanJobResult, ScanProgress } from './scan-job.types';
import { ScanProcessor } from './scan.processor';

const ASSET = { id: 'asset-1', host: 'example.com', port: 443 };

function fakeJob(attemptsMade = 0, batchId: string | null = null) {
  return {
    id: 'scan-1',
    data: { assetId: ASSET.id, scanId: 'scan-1', batchId },
    attemptsMade,
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job<ScanJobData, ScanJobResult> & { updateProgress: jest.Mock };
}

const stagesOf = (job: { updateProgress: jest.Mock }) =>
  job.updateProgress.mock.calls.map(([p]: [ScanProgress]) => p.stage);

describe('ScanProcessor', () => {
  const assets = { findOneBy: jest.fn() };
  const scanner = { scan: jest.fn() };
  const scans = { exists: jest.fn(), recordScan: jest.fn(), findOne: jest.fn() };
  const indexer = { indexScan: jest.fn() };
  const batches = { markFinished: jest.fn() };
  let processor: ScanProcessor;

  beforeAll(() => Logger.overrideLogger(false));
  afterAll(() => Logger.overrideLogger(['log', 'error', 'warn']));

  beforeEach(() => {
    jest.resetAllMocks();
    assets.findOneBy.mockResolvedValue(ASSET);
    scans.exists.mockResolvedValue(false);
    scans.recordScan.mockResolvedValue('recorded');
    scans.findOne.mockResolvedValue({ status: 'success', riskScore: 20, riskLevel: 'medium', errorCode: null });
    scanner.scan.mockResolvedValue(makeScan());
    indexer.indexScan.mockResolvedValue(2);
    batches.markFinished.mockResolvedValue({ batchId: 'b1', total: 2, completed: 1, failed: 0, percent: 50 });

    processor = new ScanProcessor(
      assets as never,
      scanner as never,
      scans as never,
      indexer as never,
      batches as never,
      {} as never,
    );
  });

  it('runs scanning -> saving -> indexing -> completed and returns the result', async () => {
    const job = fakeJob(0, 'b1');

    const result = await processor.process(job);

    expect(stagesOf(job)).toEqual(['scanning', 'saving', 'indexing', 'completed']);
    expect(scans.recordScan).toHaveBeenCalledWith(expect.objectContaining({ scanId: 'scan-1', assetId: ASSET.id }));
    expect(indexer.indexScan).toHaveBeenCalledWith('scan-1');
    expect(result).toMatchObject({ scanId: 'scan-1', status: 'success', riskScore: 20, findingsIndexed: 2 });
    expect(batches.markFinished).toHaveBeenCalledWith('b1', 'completed');
    expect(job.updateProgress.mock.calls.at(-1)[0]).toMatchObject({ stage: 'completed', percent: 100, batch: { percent: 50 } });
  });

  it('throws a temporary network error so BullMQ retries (attempts left)', async () => {
    scanner.scan.mockRejectedValue(new ScanError('TIMEOUT', 'No TLS handshake within 5000ms'));
    const job = fakeJob(0, 'b1');

    await expect(processor.process(job)).rejects.toThrow('No TLS handshake');

    expect(scans.recordScan).not.toHaveBeenCalled();
    expect(batches.markFinished).not.toHaveBeenCalled(); // not finished yet
    expect(stagesOf(job)).toEqual(['scanning', 'retrying']);
    expect(job.updateProgress.mock.calls[1][0].message).toContain('Retrying in 2s');
  });

  it('uses exponential backoff in the retry message (2s, then 4s)', async () => {
    scanner.scan.mockRejectedValue(new ScanError('CONNECTION_RESET', 'reset'));
    const second = fakeJob(1);

    await expect(processor.process(second)).rejects.toThrow();

    expect(second.updateProgress.mock.calls.at(-1)[0]).toMatchObject({ stage: 'retrying', attempt: 2 });
    expect(second.updateProgress.mock.calls.at(-1)[0].message).toContain('Retrying in 4s');
  });

  it('on the LAST attempt, saves the temporary error as a failed scan instead of retrying', async () => {
    const error = new ScanError('TIMEOUT', 'still down');
    scanner.scan.mockRejectedValue(error);

    const result = await processor.process(fakeJob(2)); // attempt 3 of 3

    expect(scans.recordScan).toHaveBeenCalledWith(expect.objectContaining({ outcome: error }));
    expect(result.scanId).toBe('scan-1');
  });

  it('saves a permanent error (DNS name does not exist) immediately, without retrying', async () => {
    const error = new ScanError('DNS_NOT_FOUND', 'getaddrinfo ENOTFOUND');
    scanner.scan.mockRejectedValue(error);
    const job = fakeJob(0);

    await processor.process(job);

    expect(scans.recordScan).toHaveBeenCalledWith(expect.objectContaining({ outcome: error }));
    expect(stagesOf(job)).toEqual(['scanning', 'saving', 'indexing', 'completed']);
  });

  it('does not scan again when a previous attempt already saved the scan (idempotent retry)', async () => {
    scans.exists.mockResolvedValue(true);
    const job = fakeJob(1);

    await processor.process(job);

    expect(scanner.scan).not.toHaveBeenCalled();
    expect(scans.recordScan).not.toHaveBeenCalled();
    expect(indexer.indexScan).toHaveBeenCalledWith('scan-1');
    expect(stagesOf(job)).toEqual(['indexing', 'completed']);
  });

  it('lets infrastructure errors (Elasticsearch down) fail the attempt so it is retried', async () => {
    indexer.indexScan.mockRejectedValue(new Error('connect ECONNREFUSED elasticsearch:9200'));
    const job = fakeJob(0);

    await expect(processor.process(job)).rejects.toThrow('ECONNREFUSED');
    expect(stagesOf(job).at(-1)).toBe('retrying');
  });

  it('fails without retry (UnrecoverableError) when the asset was deleted, and counts it in the batch', async () => {
    assets.findOneBy.mockResolvedValue(null);
    const job = fakeJob(0, 'b1');

    await expect(processor.process(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(stagesOf(job)).toEqual(['failed']);
    expect(batches.markFinished).toHaveBeenCalledWith('b1', 'failed');
  });

  it('still rethrows the real error when reporting progress itself fails', async () => {
    assets.findOneBy.mockResolvedValue(null);
    const job = fakeJob(0);
    job.updateProgress.mockRejectedValue(new Error('Redis down'));

    await expect(processor.process(job)).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
