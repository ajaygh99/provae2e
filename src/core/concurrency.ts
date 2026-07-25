/** Runs async work with a fixed concurrency limit while preserving input order. */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  workers: number,
  operation: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index], index);
    }
  }

  const workerCount = Math.min(workers, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
