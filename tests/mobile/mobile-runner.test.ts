/**
 * Mobile Runner Tests
 */
import { existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { runMobileTest, SUPPORTED_DEVICES } from '../../src/runners/mobile-runner';

jest.setTimeout(60000);

describe('Mobile Runner', () => {
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

  it('exposes the 5 required device aliases', () => {
    expect(SUPPORTED_DEVICES).toEqual(
      expect.arrayContaining(['iphone14', 'iphonese', 'pixel7', 'galaxys21', 'ipad'])
    );
    expect(SUPPORTED_DEVICES.length).toBeGreaterThanOrEqual(5);
  });

  it('passes for a reachable page with a title, writing a screenshot', async () => {
    const result = await runMobileTest({ url: baseUrl, device: 'iPhone14', screenshotDir, scope: 'full' });

    expect(result.status).toBe('PASS');
    expect(result.device).toBe('iPhone 14');
    expect(result.title).toBe('Test Page Title');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.screenshotPath).toBeDefined();
    expect(existsSync(result.screenshotPath as string)).toBe(true);
    expect(result.checks).toEqual([
      'page loaded',
      'non-empty title',
      'emulated iPhone 14',
      'body rendered',
      'HTTP 200',
      'no uncaught page errors',
      'no horizontal viewport overflow'
    ]);
  });

  it.each([
    ['iPhoneSE', 'iPhone SE'],
    ['Pixel7', 'Pixel 7'],
    ['GalaxyS21', 'Galaxy S24'],
    ['iPad', 'iPad (gen 7)']
  ])('resolves device alias %s to Playwright device %s', async (alias, resolved) => {
    const result = await runMobileTest({ url: baseUrl, device: alias, screenshotDir });

    expect(result.status).toBe('PASS');
    expect(result.device).toBe(resolved);
  });

  it('accepts an exact Playwright device key in addition to aliases', async () => {
    const result = await runMobileTest({ url: baseUrl, device: 'iPhone 14 Pro', screenshotDir });

    expect(result.status).toBe('PASS');
    expect(result.device).toBe('iPhone 14 Pro');
  });

  it('creates the screenshot directory when it does not already exist', async () => {
    const freshDir = path.join(__dirname, '.tmp-screenshots-fresh');
    expect(existsSync(freshDir)).toBe(false);

    await runMobileTest({ url: baseUrl, device: 'iPhone14', screenshotDir: freshDir });

    expect(existsSync(freshDir)).toBe(true);
    rmSync(freshDir, { recursive: true, force: true });
  });

  it('fails without throwing for an unknown device', async () => {
    const result = await runMobileTest({ url: baseUrl, device: 'NotARealDevice', screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(result.device).toBe('NotARealDevice');
    expect(result.error).toContain('Unknown device');
    expect(result.screenshotPath).toBeUndefined();
  });

  it('fails without throwing when the page has no title', async () => {
    const result = await runMobileTest({ url: `${baseUrl}/no-title`, device: 'iPhone14', screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(result.title).toBe('');
    expect(result.error).toBe('Page title is empty');
  });

  it('fails without throwing when navigation errors out', async () => {
    const result = await runMobileTest({ url: 'http://127.0.0.1:1', device: 'iPhone14', screenshotDir });

    expect(result.status).toBe('FAIL');
    expect(result.error).toBeDefined();
    expect(result.title).toBeUndefined();
    expect(result.screenshotPath).toBeUndefined();
  });

  it('resolves a configured selector and reports the tier that succeeded', async () => {
    const result = await runMobileTest({
      url: `${baseUrl}/with-target`,
      device: 'iPhone14',
      screenshotDir,
      selector: { testId: 'hero' }
    });

    expect(result.status).toBe('PASS');
    expect(result.selectorTier).toBe('data-testid');
  });

  it('fails without throwing when the configured selector cannot be resolved', async () => {
    const result = await runMobileTest({
      url: `${baseUrl}/with-target`,
      device: 'iPhone14',
      screenshotDir,
      selector: { testId: 'no-such-target' }
    });

    expect(result.status).toBe('FAIL');
    expect(result.error).toContain('Unable to resolve selector');
    expect(result.screenshotPath).toBeUndefined();
  });

  it('defaults the screenshot directory when none is provided', async () => {
    const defaultDir = path.join(process.cwd(), 'screenshots');
    const result = await runMobileTest({ url: baseUrl, device: 'iPhone14' });

    expect(result.status).toBe('PASS');
    expect(result.screenshotPath).toContain('screenshots');
    expect(existsSync(defaultDir)).toBe(true);
  });
});
