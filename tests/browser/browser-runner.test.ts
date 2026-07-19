/**
 * Browser Runner Tests
 */
import { existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { runBrowserTest } from '../../src/runners/browser-runner';

jest.setTimeout(30000);

describe('Browser Runner', () => {
  let server: http.Server;
  let baseUrl: string;
  const screenshotDir = path.join(__dirname, '.tmp-screenshots');

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/no-title') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head></head><body>no title here</body></html>');
        return;
      }
      if (req.url === '/with-target') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Test Page Title</title></head><body><div data-testid="hero">Hero</div></body></html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Test Page Title</title></head><body>Hello</body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (existsSync(screenshotDir)) {
      rmSync(screenshotDir, { recursive: true, force: true });
    }
  });

  it('passes for a reachable page with a title, writing a screenshot', async () => {
    const result = await runBrowserTest({ url: baseUrl, screenshotDir });

    expect(result.status).toBe('PASS');
    expect(result.title).toBe('Test Page Title');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.screenshotPath).toBeDefined();
    expect(existsSync(result.screenshotPath as string)).toBe(true);
  });

  it('creates the screenshot directory when it does not already exist', async () => {
    const freshDir = path.join(__dirname, '.tmp-screenshots-fresh');
    expect(existsSync(freshDir)).toBe(false);

    await runBrowserTest({ url: baseUrl, screenshotDir: freshDir });

    expect(existsSync(freshDir)).toBe(true);
    rmSync(freshDir, { recursive: true, force: true });
  });

  it('fails without throwing when the page has no title', async () => {
    const result = await runBrowserTest({ url: `${baseUrl}/no-title`, screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(result.title).toBe('');
    expect(result.error).toBe('Page title is empty');
  });

  it('fails without throwing when navigation errors out', async () => {
    const result = await runBrowserTest({ url: 'http://127.0.0.1:1', screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(result.error).toBeDefined();
    expect(result.title).toBeUndefined();
    expect(result.screenshotPath).toBeUndefined();
  });

  it('resolves a configured selector and reports the tier that succeeded', async () => {
    const result = await runBrowserTest({
      url: `${baseUrl}/with-target`,
      screenshotDir,
      selector: { testId: 'hero' }
    });

    expect(result.status).toBe('PASS');
    expect(result.selectorTier).toBe('data-testid');
  });

  it('fails without throwing when the configured selector cannot be resolved', async () => {
    const result = await runBrowserTest({
      url: `${baseUrl}/with-target`,
      screenshotDir,
      selector: { testId: 'no-such-target' }
    });

    expect(result.status).toBe('FAIL');
    expect(result.error).toContain('Unable to resolve selector');
    expect(result.screenshotPath).toBeUndefined();
  });

  it('defaults the screenshot directory when none is provided', async () => {
    const defaultDir = path.join(process.cwd(), 'screenshots');
    const result = await runBrowserTest({ url: baseUrl });

    expect(result.status).toBe('PASS');
    expect(result.screenshotPath).toContain('screenshots');
    expect(existsSync(defaultDir)).toBe(true);

    rmSync(defaultDir, { recursive: true, force: true });
  });
});
