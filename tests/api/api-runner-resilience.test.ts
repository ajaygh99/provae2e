/**
 * API Runner — "never throws" contract.
 * Verifies request-context creation and teardown (context.dispose()) failures
 * always resolve to a FAIL/PASS result object rather than rejecting.
 */
const mockNewContext = jest.fn();

jest.mock('@playwright/test', (): object => ({
  request: { newContext: (...args: unknown[]) => mockNewContext(...(args as [])) }
}));

import { runApiTest } from '../../src/runners/api-runner';

describe('API Runner — never-throws contract', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves to a FAIL result (never rejects) when request-context creation fails', async () => {
    mockNewContext.mockRejectedValue(new Error('context creation crashed'));

    await expect(
      runApiTest({ url: 'https://example.com', method: 'GET', expectedStatus: 200 })
    ).resolves.toMatchObject({ status: 'FAIL' });
  });

  it('still returns the PASS result even when teardown (context.dispose) throws', async () => {
    mockNewContext.mockResolvedValue({
      get: jest.fn().mockResolvedValue({
        status: () => 200,
        text: async () => '{"ok":true}'
      }),
      dispose: jest.fn().mockRejectedValue(new Error('dispose crashed'))
    });

    const result = await runApiTest({ url: 'https://example.com', method: 'GET', expectedStatus: 200 });

    expect(result.status).toBe('PASS');
  });

  it('still returns the original FAIL result (not a teardown crash) when both the request and teardown fail', async () => {
    mockNewContext.mockResolvedValue({
      get: jest.fn().mockRejectedValue(new Error('network crashed')),
      dispose: jest.fn().mockRejectedValue(new Error('dispose also crashed'))
    });

    const result = await runApiTest({ url: 'https://example.com', method: 'GET', expectedStatus: 200 });

    expect(result.status).toBe('FAIL');
    expect(result.error).toBe('network crashed');
  });
});
