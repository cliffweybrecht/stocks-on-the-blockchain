export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index] as T, index);
    }
  });

  await Promise.all(workers);
  return results;
}

export function createRequestGate(options: { maxConcurrent: number; minGapMs: number }) {
  const maxConcurrent = Math.max(1, options.maxConcurrent);
  const minGapMs = Math.max(0, options.minGapMs);
  let active = 0;
  let lastStart = 0;
  const waiters: Array<() => void> = [];

  function pump() {
    if (active >= maxConcurrent) return;
    const waiter = waiters.shift();
    if (!waiter) return;
    active += 1;
    const wait = Math.max(0, minGapMs - (Date.now() - lastStart));
    lastStart = Date.now() + wait;
    if (wait > 0) {
      setTimeout(waiter, wait);
    } else {
      waiter();
    }
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
      pump();
    });
    try {
      return await fn();
    } finally {
      active -= 1;
      pump();
    }
  }

  return { run };
}
