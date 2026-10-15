/**
 * Returns a function that runs async tasks with at most `max` running at the same time.
 * Without this, scanning 1,000 hosts would open 1,000 sockets at once.
 */
export function createLimiter(max: number) {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`Concurrency must be a positive integer, got ${max}`);
  }

  let active = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (active >= max) return;
    const start = queue.shift();
    if (!start) return;
    active++;
    start();
  };

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        // Promise.resolve().then(task) also catches a task that throws synchronously.
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            runNext();
          });
      });
      runNext();
    });
  };
}
