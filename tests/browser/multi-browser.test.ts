import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { runBrowserTest, type BrowserName } from '../../src/runners/browser-runner';

jest.setTimeout(120000);

describe.each<BrowserName>(['chromium', 'firefox', 'webkit'])('%s browser execution', browser => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><head><title>PROVA cross-browser</title></head><body>ready</body></html>');
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('runs the same smoke contract and records the browser engine', async () => {
    const result = await runBrowserTest({ url, browser, scope: 'smoke' });
    expect(result).toMatchObject({ status: 'PASS', browser, title: 'PROVA cross-browser' });
  });
});
