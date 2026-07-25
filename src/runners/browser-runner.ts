/**
 * Browser Runner — headless Playwright browser test execution
 * Visits a URL, takes a screenshot, and asserts the page loaded with a title.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { log } from '../core/logger.js';
import { resolveSelector, type SelectorDescriptor, type SelectorTier } from '../core/self-healing-selector.js';
import { executeWithRetry } from '../core/retry-handler.js';

/** Options accepted by {@link runBrowserTest}. */
export interface BrowserRunnerOptions {
  /** Target URL to visit. */
  url: string;
  /** Directory to write the screenshot into. Defaults to './screenshots'. */
  screenshotDir?: string;
  /** When set, resolves this element via the self-healing 5-tier fallback after navigation. */
  selector?: SelectorDescriptor;
  /** Retry count after the initial attempt. Defaults to 0 for programmatic use. */
  retries?: number;
  /** Initial exponential-backoff delay. Defaults to 1000ms. */
  retryBaseDelayMs?: number;
  /** Verification depth selected by the CLI. */
  scope?: 'smoke' | 'cr' | 'component' | 'full';
}

/** Outcome of a single browser test run. */
export interface BrowserRunResult {
  /** PASS if the page loaded and returned a non-empty title, FAIL otherwise. */
  status: 'PASS' | 'FAIL';
  /** The URL that was tested. */
  url: string;
  /** The page title captured, when available. */
  title?: string;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs: number;
  /** Path to the screenshot written to disk, when available. */
  screenshotPath?: string;
  /** The fallback tier that resolved {@link BrowserRunnerOptions.selector}, when one was configured. */
  selectorTier?: SelectorTier;
  /** Error message, populated only when status is FAIL. */
  error?: string;
  /** Checks completed by the selected scope. */
  checks?: string[];
  /** Capability limitations that do not make the listing/page check fail. */
  warnings?: string[];
}

/** Builds a filesystem-safe screenshot filename from a URL and timestamp. */
function screenshotFileName(url: string): string {
  const safeUrl = url.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${Date.now()}-${safeUrl}.png`;
}

/**
 * Runs a headless Playwright browser test against a URL.
 * Navigates to the URL, captures a screenshot, and asserts the page has a title.
 * Never throws — navigation and assertion failures are reported as a FAIL result.
 *
 * @param options - Target URL and optional screenshot directory.
 * @returns The PASS/FAIL result with duration and screenshot path.
 */
async function runBrowserTestOnce(options: BrowserRunnerOptions): Promise<BrowserRunResult> {
  const { url } = options;
  const screenshotDir = options.screenshotDir ?? './screenshots';
  const startedAt = Date.now();

  let browser: Browser | undefined;
  try {
    log.info('Launching headless browser', { url });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on?.('pageerror', (error) => pageErrors.push(error.message));

    const response = await page.goto(url, { waitUntil: 'load' });
    const title = await page.title();
    const scope = options.scope ?? 'smoke';
    const checks = ['page loaded', 'non-empty title'];
    const warnings: string[] = [];

    if (scope === 'component' || scope === 'cr' || scope === 'full') {
      const hasBody = await page.locator('body').count();
      if (hasBody === 0) {
        return {
          status: 'FAIL',
          url,
          title,
          durationMs: Date.now() - startedAt,
          checks,
          error: 'Page has no body element'
        };
      }
      checks.push('body rendered');
    }
    if (scope === 'cr' || scope === 'full') {
      const status = response?.status();
      if (status === undefined || status >= 400) {
        return {
          status: 'FAIL',
          url,
          title,
          durationMs: Date.now() - startedAt,
          checks,
          error: `Navigation returned HTTP ${status ?? 'unknown'}`
        };
      }
      checks.push(`HTTP ${status}`);
    }
    if (scope === 'full') {
      if (pageErrors.length > 0) {
        return {
          status: 'FAIL',
          url,
          title,
          durationMs: Date.now() - startedAt,
          checks,
          error: `Uncaught page error: ${pageErrors[0]}`
        };
      }
      checks.push('no uncaught page errors');
    }
    if (new URL(url).hostname === 'chromewebstore.google.com') {
      warnings.push('Chrome Web Store listing only; headless testing does not install or execute the extension');
      log.warn('Chrome Web Store capability limited to listing verification', { url });
    }

    let selectorTier: SelectorTier | undefined;
    if (options.selector) {
      try {
        const resolved = await resolveSelector(page, options.selector);
        selectorTier = resolved.tier;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        log.error('Browser run failed: selector could not be resolved', err);
        return { status: 'FAIL', url, title, durationMs, error: message };
      }
    }

    await mkdir(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, screenshotFileName(url));
    await page.screenshot({ path: screenshotPath });

    const durationMs = Date.now() - startedAt;

    if (!title) {
      log.error('Browser run failed: page has no title', undefined);
      return {
        status: 'FAIL',
        url,
        title,
        durationMs,
        screenshotPath,
        selectorTier,
        checks,
        warnings,
        error: 'Page title is empty'
      };
    }

    log.success('Browser run passed', { url, title, durationMs, screenshotPath });
    return { status: 'PASS', url, title, durationMs, screenshotPath, selectorTier, checks, warnings };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    log.error('Browser run failed', err);
    return { status: 'FAIL', url, durationMs, error: message };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        log.warn('Browser run: failed to close browser cleanly', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
}

/** Runs a browser test and retries failed results using exponential backoff. */
export async function runBrowserTest(options: BrowserRunnerOptions): Promise<BrowserRunResult> {
  return executeWithRetry(() => runBrowserTestOnce(options), {
    maxRetries: options.retries ?? 0,
    baseDelayMs: options.retryBaseDelayMs ?? 1000,
    shouldRetry: (result) => result.status === 'FAIL'
  });
}
