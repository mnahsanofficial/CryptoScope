/**
 * Prints live scan progress from the Socket.IO namespace /scans.
 *
 *   CRYPTOSCOPE_TOKEN=<jwt> npm run scans:watch      # http://localhost:3001
 *   CRYPTOSCOPE_TOKEN=<jwt> npm run scans:watch -- http://localhost:3002
 *
 * Get a token with:  curl -s -X POST localhost:3001/api/auth/login -H 'content-type: application/json' \
 *                      -d '{"email":"...","password":"..."}'
 */
import { io } from 'socket.io-client';
import { BatchProgress, ScanProgress } from '../scan-jobs/scan-job.types';

const url = process.argv[2] ?? 'http://localhost:3001';
const token = process.env.CRYPTOSCOPE_TOKEN;
if (!token) {
  console.error('Set CRYPTOSCOPE_TOKEN to a JWT from POST /api/auth/login');
  process.exit(1);
}
const socket = io(`${url}/scans`, { transports: ['websocket'], auth: { token } });

const time = () => new Date().toISOString().slice(11, 19);
const bar = (percent: number) => `[${'#'.repeat(Math.round(percent / 10)).padEnd(10, '.')}] ${String(percent).padStart(3)}%`;

socket.on('connect', () => console.log(`${time()} connected to ${url}/scans (Ctrl+C to stop)`));
socket.on('disconnect', (reason) => console.log(`${time()} disconnected: ${reason}`));
socket.on('connect_error', (err) => console.error(`${time()} cannot connect: ${err.message}`));

socket.on('scan.progress', (p: ScanProgress) => {
  const attempt = p.maxAttempts > 1 ? ` attempt ${p.attempt}/${p.maxAttempts}` : '';
  console.log(`${time()} ${bar(p.percent)} ${p.stage.padEnd(9)} job ${p.jobId.slice(0, 8)}${attempt}${p.message ? `  ${p.message}` : ''}`);
});

socket.on('batch.progress', (b: BatchProgress) => {
  console.log(`${time()} BATCH ${b.batchId.slice(0, 8)} ${bar(b.percent)} ${b.completed} done, ${b.failed} failed of ${b.total}`);
});
