/**
 * Mobile Runner — "never throws" contract.
 * Verifies browser launch, device context creation, and teardown
 * (context.close()/browser.close()) failures always resolve to a FAIL/PASS
 * result object rather than rejecting.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';

const mockLaunch = jest.fn();

jest.mock('@playwright/test', (): object => ({
  chromium: { launch: (...args: unknown[]) => mockLaunch(...(args as [])) },
  devices: { 'iPhone 14': { viewport: { width: 390, height: 844 } } }
}));

import { runMobileTest } from '../../src/runners/mobile-runner';

describe('Mobile Runner — never-throws contract', () => {
  const screenshotDir = path.join(__dirname, '.tmp-resilience-screenshots');

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    rmSync(screenshotDir, { recursive: true, force: true });
  });

  it('resolves to a FAIL result (never rejects) when browser launch fails', async () => {
    mockLaunch.mockRejectedValue(new Error("Executable doesn't exist"));

    await expect(
      runMobileTest({ url: 'https://example.com', device: 'iPhone14', screenshotDir })
    ).resolves.toMatchObject({ status: 'FAIL' });
  });

  it('resolves to a FAIL result (never rejects) when context creation fails, and still tears down the browser', async () => {
    const mockBrowserClose = jest.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newContext: jest.fn().mockRejectedValue(new Error('newContext crashed')),
      close: mockBrowserClose
    });

    const result = await runMobileTest({ url: 'https://example.com', device: 'iPhone14', screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(mockBrowserClose).toHaveBeenCalledTimes(1);
  });

  it('resolves to a FAIL result (never rejects) when page creation fails, and still tears down the context and browser', async () => {
    const mockContextClose = jest.fn().mockResolvedValue(undefined);
    const mockBrowserClose = jest.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newContext: jest.fn().mockResolvedValue({
        newPage: jest.fn().mockRejectedValue(new Error('newPage crashed')),
        close: mockContextClose
      }),
      close: mockBrowserClose
    });

    const result = await runMobileTest({ url: 'https://example.com', device: 'iPhone14', screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(mockContextClose).toHaveBeenCalledTimes(1);
    expect(mockBrowserClose).toHaveBeenCalledTimes(1);
  });

  it('still returns the PASS result even when teardown (context.close and browser.close) throw', async () => {
    const mockPage = {
      goto: jest.fn().mockResolvedValue(undefined),
      title: jest.fn().mockResolvedValue('Some Title'),
      screenshot: jest.fn().mockResolvedValue(undefined)
    };
    mockLaunch.mockResolvedValue({
      newContext: jest.fn().mockResolvedValue({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockRejectedValue(new Error('context close crashed'))
      }),
      close: jest.fn().mockRejectedValue(new Error('browser close crashed'))
    });

    const result = await runMobileTest({ url: 'https://example.com', device: 'iPhone14', screenshotDir });

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
      newContext: jest.fn().mockResolvedValue({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockRejectedValue(new Error('context close crashed'))
      }),
      close: jest.fn().mockRejectedValue(new Error('browser close crashed'))
    });

    const result = await runMobileTest({ url: 'https://example.com', device: 'iPhone14', screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(result.error).toBe('nav crashed');
  });
});
