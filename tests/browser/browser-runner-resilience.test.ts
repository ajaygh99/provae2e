/**
 * Browser Runner — "never throws" contract.
 * Verifies browser launch, page creation, and teardown (browser.close())
 * failures always resolve to a FAIL/PASS result object rather than rejecting.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';

const mockLaunch = jest.fn();

jest.mock('@playwright/test', (): object => ({
  chromium: { launch: (...args: unknown[]) => mockLaunch(...(args as [])) }
}));

import { runBrowserTest } from '../../src/runners/browser-runner';

describe('Browser Runner — never-throws contract', () => {
  const screenshotDir = path.join(__dirname, '.tmp-resilience-screenshots');

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    rmSync(screenshotDir, { recursive: true, force: true });
  });

  it('resolves to a FAIL result (never rejects) when browser launch fails', async () => {
    mockLaunch.mockRejectedValue(new Error("Executable doesn't exist"));

    await expect(runBrowserTest({ url: 'https://example.com', screenshotDir })).resolves.toMatchObject({
      status: 'FAIL'
    });
  });

  it('resolves to a FAIL result (never rejects) when page creation fails, and still tears down the browser', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newPage: jest.fn().mockRejectedValue(new Error('newPage crashed')),
      close: mockClose
    });

    const result = await runBrowserTest({ url: 'https://example.com', screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('still returns the PASS result even when teardown (browser.close) throws', async () => {
    const mockPage = {
      goto: jest.fn().mockResolvedValue(undefined),
      title: jest.fn().mockResolvedValue('Some Title'),
      screenshot: jest.fn().mockResolvedValue(undefined)
    };
    mockLaunch.mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockRejectedValue(new Error('close crashed'))
    });

    const result = await runBrowserTest({ url: 'https://example.com', screenshotDir });

    expect(result.status).toBe('PASS');
    expect(result.title).toBe('Some Title');
  });

  it('still returns the original FAIL result (not a teardown crash) when both the run and teardown fail', async () => {
    const mockPage = {
      goto: jest.fn().mockRejectedValue(new Error('nav crashed')),
      title: jest.fn(),
      screenshot: jest.fn()
    };
    mockLaunch.mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockRejectedValue(new Error('close also crashed'))
    });

    const result = await runBrowserTest({ url: 'https://example.com', screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(result.error).toBe('nav crashed');
  });
});
