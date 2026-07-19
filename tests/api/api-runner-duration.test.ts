/**
 * API Runner — duration measurement.
 * Verifies durationMs reflects the time until the response body has been
 * fully read, not just until headers/status are available. Mocks
 * @playwright/test directly so response.text() can be made artificially slow,
 * isolating the runner's own timing arithmetic from real network/Playwright
 * buffering behavior.
 */
const mockNewContext = jest.fn();

jest.mock('@playwright/test', (): object => ({
  request: { newContext: (...args: unknown[]) => mockNewContext(...(args as [])) }
}));

import { runApiTest } from '../../src/runners/api-runner';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('API Runner — duration measurement', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('measures duration after the response body is fully consumed, not just after status is available', async () => {
    const bodyReadDelayMs = 300;

    mockNewContext.mockResolvedValue({
      get: jest.fn().mockResolvedValue({
        status: () => 200,
        text: async () => {
          await delay(bodyReadDelayMs);
          return '{"ok":true}';
        }
      }),
      dispose: jest.fn().mockResolvedValue(undefined)
    });

    const result = await runApiTest({ url: 'https://example.com', method: 'GET', expectedStatus: 200 });

    expect(result.status).toBe('PASS');
    // response.text() takes bodyReadDelayMs to resolve - if duration were captured
    // right after response.status() (the old bug), this would be near-zero instead.
    expect(result.durationMs).toBeGreaterThanOrEqual(bodyReadDelayMs - 20);
  });
});
