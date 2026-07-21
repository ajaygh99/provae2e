import { log } from './logger.js';

/** Configuration for retrying an asynchronous operation. */
export interface RetryOptions<T> {
  /** Number of retries after the initial attempt. Defaults to 3. */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds. Defaults to 1000. */
  baseDelayMs?: number;
  /** Determines whether a returned value represents a failure. */
  shouldRetry: (result: T) => boolean;
  /** Injectable delay function, primarily for deterministic tests. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** Resolves after the requested delay. */
async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Executes an operation with exponential backoff until it passes or retries are exhausted.
 * Returned failures and thrown errors are both retried; the final result/error is preserved.
 */
export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions<T>
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new Error('maxRetries must be a non-negative integer');
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0) throw new Error('baseDelayMs must be a non-negative integer');
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      const result = await operation(attempt);
      if (!options.shouldRetry(result) || attempt > maxRetries) return result;
    } catch (error) {
      if (attempt > maxRetries) throw error;
    }

    const delayMs = baseDelayMs * 2 ** (attempt - 1);
    log.warn('Retrying failed test', { retryAttempt: attempt, maxRetries, delayMs });
    await sleep(delayMs);
  }
  throw new Error('Retry handler reached an unreachable state');
}
