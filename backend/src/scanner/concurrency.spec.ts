import { createLimiter } from './concurrency';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createLimiter', () => {
  it('never runs more than `max` tasks at once', async () => {
    const limit = createLimiter(3);
    let running = 0;
    let peak = 0;

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        limit(async () => {
          running++;
          peak = Math.max(peak, running);
          await delay(5);
          running--;
          return i;
        }),
      ),
    );

    expect(peak).toBe(3);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('keeps going after a task fails, including one that throws synchronously', async () => {
    const limit = createLimiter(1);

    const outcomes = await Promise.allSettled([
      limit(() => {
        throw new Error('sync failure');
      }),
      limit(() => Promise.reject(new Error('async failure'))),
      limit(() => Promise.resolve('still runs')),
    ]);

    expect(outcomes.map((o) => o.status)).toEqual(['rejected', 'rejected', 'fulfilled']);
  });

  it('rejects an invalid limit', () => {
    expect(() => createLimiter(0)).toThrow('positive integer');
  });
});
