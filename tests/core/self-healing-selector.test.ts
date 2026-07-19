/**
 * Self-Healing Selector Tests
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { resolveSelector, SelectorResolutionError } from '../../src/core/self-healing-selector';

jest.setTimeout(30000);

const FIXTURE_HTML = `
<html>
  <head><title>Selector Fixture</title></head>
  <body style="margin:0">
    <button aria-label="Submit Form">Submit</button>
    <div data-testid="test-id-target">TestID Target</div>
    <p>Unique Text Content Here</p>
    <div style="display:none">Hidden Element With No Bounding Box</div>
    <div style="position:absolute; left:100px; top:50px; width:120px; height:40px;">Position Target</div>
    <span class="css-only-target">CSS Target</span>
  </body>
</html>`;

describe('resolveSelector', () => {
  let server: http.Server;
  let baseUrl: string;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(FIXTURE_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'load' });
  });

  afterEach(async () => {
    await page.close();
  });

  it('resolves via tier 1 — ARIA role/label', async () => {
    const result = await resolveSelector(page, { role: { role: 'button', name: 'Submit Form' } });
    expect(result.tier).toBe('aria-role');
    expect(await result.locator.textContent()).toBe('Submit');
  });

  it('resolves via tier 2 — data-testid', async () => {
    const result = await resolveSelector(page, { testId: 'test-id-target' });
    expect(result.tier).toBe('data-testid');
    expect(await result.locator.textContent()).toBe('TestID Target');
  });

  it('resolves via tier 3 — text content', async () => {
    const result = await resolveSelector(page, { text: 'Unique Text Content Here' });
    expect(result.tier).toBe('text-content');
  });

  it('resolves via tier 4 — visual position hash', async () => {
    const result = await resolveSelector(page, { position: { x: 100, y: 50, width: 120, height: 40 } });
    expect(result.tier).toBe('visual-position');
    expect(await result.locator.textContent()).toBe('Position Target');
  });

  it('resolves via tier 4 within tolerance of a slightly imprecise position', async () => {
    const result = await resolveSelector(page, { position: { x: 103, y: 47, width: 122, height: 38 } });
    expect(result.tier).toBe('visual-position');
  });

  it('resolves via tier 5 — raw CSS selector', async () => {
    const result = await resolveSelector(page, { css: '.css-only-target' });
    expect(result.tier).toBe('css-selector');
    expect(await result.locator.textContent()).toBe('CSS Target');
  });

  it('falls through tier 1 to tier 2 when the role does not match', async () => {
    const result = await resolveSelector(page, {
      role: { role: 'checkbox' },
      testId: 'test-id-target'
    });
    expect(result.tier).toBe('data-testid');
  });

  it('falls through tiers 1 and 2 to tier 3 when neither matches', async () => {
    const result = await resolveSelector(page, {
      role: { role: 'checkbox' },
      testId: 'no-such-testid',
      text: 'Unique Text Content Here'
    });
    expect(result.tier).toBe('text-content');
  });

  it('falls through tier 4 to tier 5 when the position is outside tolerance', async () => {
    const result = await resolveSelector(page, {
      position: { x: 500, y: 500, width: 120, height: 40 },
      css: '.css-only-target'
    });
    expect(result.tier).toBe('css-selector');
  });

  it('throws SelectorResolutionError when every configured tier fails', async () => {
    await expect(
      resolveSelector(page, {
        role: { role: 'checkbox' },
        testId: 'no-such-testid',
        text: 'no-such-text',
        position: { x: 0, y: 0, width: 1, height: 1 },
        css: '.no-such-class'
      })
    ).rejects.toThrow(SelectorResolutionError);
  });

  it('throws SelectorResolutionError when no tier is configured', async () => {
    await expect(resolveSelector(page, {})).rejects.toThrow(SelectorResolutionError);
  });

  it('falls through when a tier throws instead of returning no match', async () => {
    const result = await resolveSelector(page, {
      position: { scope: '[[[invalid', x: 0, y: 0, width: 1, height: 1 },
      css: '.css-only-target'
    });
    expect(result.tier).toBe('css-selector');
  });
});
