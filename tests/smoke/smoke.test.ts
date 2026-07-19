/**
 * Post-deploy smoke suite — a minimal, real end-to-end sanity check that the
 * three runners still work together against a live target. Distinct from the
 * exhaustive per-runner test suites elsewhere: this is meant to be small,
 * fast, and the single thing prova-ci.yml's "Post-deploy Smoke" job runs
 * after SHIP publishes, to confirm the published package is actually usable.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runBrowserTest } from '../../src/runners/browser-runner';
import { runApiTest } from '../../src/runners/api-runner';
import { runMobileTest } from '../../src/runners/mobile-runner';

jest.setTimeout(30000);

describe('Smoke suite', () => {
  let server: http.Server;
  let baseUrl: string;
  const screenshotDir = path.join(__dirname, '.tmp-smoke-screenshots');

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/api') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>PROVA Smoke Target</title></head><body>Smoke</body></html>');
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

  it('the browser runner can load a page end-to-end', async () => {
    const result = await runBrowserTest({ url: baseUrl, screenshotDir });
    expect(result.status).toBe('PASS');
  });

  it('the API runner can complete a request end-to-end', async () => {
    const result = await runApiTest({ url: `${baseUrl}/api`, method: 'GET', expectedStatus: 200 });
    expect(result.status).toBe('PASS');
  });

  it('the mobile runner can emulate a device end-to-end', async () => {
    const result = await runMobileTest({ url: baseUrl, device: 'iPhone14', screenshotDir });
    expect(result.status).toBe('PASS');
  });
});
