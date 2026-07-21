import { executeWithRetry } from '../../src/core/retry-handler';

const noWait = async (): Promise<void> => Promise.resolve();

describe('executeWithRetry', () => {
  it('does not retry a passing result', async () => {
    const operation = jest.fn().mockResolvedValue('PASS');
    await expect(executeWithRetry(operation, { shouldRetry: (v) => v === 'FAIL', sleep: noWait })).resolves.toBe('PASS');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2, 3])('honours maxRetries=%i', async (maxRetries) => {
    const operation = jest.fn().mockResolvedValue('FAIL');
    await expect(executeWithRetry(operation, { maxRetries, shouldRetry: (v) => v === 'FAIL', sleep: noWait })).resolves.toBe('FAIL');
    expect(operation).toHaveBeenCalledTimes(maxRetries + 1);
  });

  it.each([
    [1, [1000]],
    [2, [1000, 2000]],
    [3, [1000, 2000, 4000]]
  ] as const)('uses exponential delays for %i retries', async (maxRetries, expected) => {
    const delays: number[] = [];
    await executeWithRetry(async () => 'FAIL', {
      maxRetries,
      shouldRetry: (v) => v === 'FAIL',
      sleep: async (ms) => { delays.push(ms); }
    });
    expect(delays).toEqual(expected);
  });

  it.each([1, 5, 25, 500])('scales backoff from base delay %i', async (baseDelayMs) => {
    const delays: number[] = [];
    await executeWithRetry(async () => 'FAIL', {
      maxRetries: 2,
      baseDelayMs,
      shouldRetry: (v) => v === 'FAIL',
      sleep: async (ms) => { delays.push(ms); }
    });
    expect(delays).toEqual([baseDelayMs, baseDelayMs * 2]);
  });

  it('stops as soon as a retry passes', async () => {
    const operation = jest.fn().mockResolvedValueOnce('FAIL').mockResolvedValueOnce('PASS');
    await expect(executeWithRetry(operation, { shouldRetry: (v) => v === 'FAIL', sleep: noWait })).resolves.toBe('PASS');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('passes one-based attempt numbers to the operation', async () => {
    const attempts: number[] = [];
    await executeWithRetry(async (attempt) => { attempts.push(attempt); return 'FAIL'; }, {
      maxRetries: 3, shouldRetry: () => true, sleep: noWait
    });
    expect(attempts).toEqual([1, 2, 3, 4]);
  });

  it('retries thrown errors and returns a later success', async () => {
    const operation = jest.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue('PASS');
    await expect(executeWithRetry(operation, { shouldRetry: () => false, sleep: noWait })).resolves.toBe('PASS');
  });

  it('throws the final error after retries are exhausted', async () => {
    await expect(executeWithRetry(async () => { throw new Error('still broken'); }, {
      maxRetries: 2, shouldRetry: () => false, sleep: noWait
    })).rejects.toThrow('still broken');
  });

  it.each([-1, 1.5, Number.NaN])('rejects invalid maxRetries %s', async (maxRetries) => {
    await expect(executeWithRetry(async () => 'PASS', { maxRetries, shouldRetry: () => false })).rejects.toThrow('maxRetries');
  });

  it.each([-1, 1.5, Number.NaN])('rejects invalid baseDelayMs %s', async (baseDelayMs) => {
    await expect(executeWithRetry(async () => 'PASS', { baseDelayMs, shouldRetry: () => false })).rejects.toThrow('baseDelayMs');
  });

  it('supports zero-delay retries', async () => {
    const sleep = jest.fn(noWait);
    await executeWithRetry(async () => 'FAIL', { maxRetries: 1, baseDelayMs: 0, shouldRetry: () => true, sleep });
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it('uses the default of three retries', async () => {
    const operation = jest.fn().mockResolvedValue('FAIL');
    await executeWithRetry(operation, { shouldRetry: () => true, sleep: noWait });
    expect(operation).toHaveBeenCalledTimes(4);
  });
});
