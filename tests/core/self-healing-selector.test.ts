/**
 * Self-Healing Selector Tests
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { resolveSelector, SelectorResolutionError } from '../../src/core/self-healing-selector.js';

jest.setTimeout(30000);

const FIXTURE_HTML = `
<html>
  <head><title>Selector Fixture</title></head>
  <body style="margin:0">
    <button aria-label="Submit Form">Submit</button>
    <div data-testid="test-id-target">TestID Target</div>
    <div data-testid="duplicate-target">Duplicate One</div>
    <div data-testid="duplicate-target">Duplicate Two</div>
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

  it('falls through when a configured tier matches more than one element', async () => {
    const result = await resolveSelector(page, {
      testId: 'duplicate-target',
      css: '.css-only-target'
    });
    expect(result.tier).toBe('css-selector');
  });

  it('skips invalid runtime values and continues to a valid fallback', async () => {
    const result = await resolveSelector(page, {
      testId: '   ',
      position: { x: Number.NaN, y: 0, width: -1, height: 10, tolerance: -1 },
      css: '.css-only-target'
    });
    expect(result.tier).toBe('css-selector');
  });

  it('accepts a position exactly on the configured tolerance boundary', async () => {
    const result = await resolveSelector(page, {
      position: { x: 105, y: 45, width: 125, height: 35, tolerance: 5 }
    });
    expect(result.tier).toBe('visual-position');
  });

  it('rejects a position just outside the configured tolerance boundary', async () => {
    const result = await resolveSelector(page, {
      position: { x: 106, y: 50, width: 120, height: 40, tolerance: 5 },
      css: '.css-only-target'
    });
    expect(result.tier).toBe('css-selector');
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

  it('continues past a detached position candidate', async () => {
    const detached = {
      boundingBox: jest.fn().mockRejectedValue(new Error('detached')),
      count: jest.fn().mockResolvedValue(1)
    };
    const matching = {
      boundingBox: jest.fn().mockResolvedValue({ x: 10, y: 20, width: 30, height: 40 }),
      count: jest.fn().mockResolvedValue(1)
    };
    const candidates = {
      count: jest.fn().mockResolvedValue(2),
      nth: jest.fn((index: number) => index === 0 ? detached : matching)
    };
    const stubPage = { locator: jest.fn().mockReturnValue(candidates) } as unknown as Page;

    const result = await resolveSelector(stubPage, {
      position: { x: 10, y: 20, width: 30, height: 40 }
    });
    expect(result.tier).toBe('visual-position');
    expect(result.locator).toBe(matching);
  });

  it('rejects an ambiguous visual-position match', async () => {
    await page.setContent(`
      <div class="same-box" style="position:absolute;left:10px;top:10px;width:20px;height:20px"></div>
      <div class="same-box" style="position:absolute;left:10px;top:10px;width:20px;height:20px"></div>
    `);
    await expect(resolveSelector(page, {
      position: { scope: '.same-box', x: 10, y: 10, width: 20, height: 20 }
    })).rejects.toThrow(SelectorResolutionError);
  });
});
