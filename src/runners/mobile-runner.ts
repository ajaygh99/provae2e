/**
 * Mobile Runner — Playwright browser tests with mobile device emulation.
 * Visits a URL under an emulated device (viewport, user agent, touch), takes a
 * screenshot, and asserts the page loaded with a title. Mirrors browser-runner.ts,
 * with the browser context created from a Playwright device descriptor.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';
import type { Browser, BrowserContext } from '@playwright/test';
import { log } from '../core/logger.js';
import { resolveSelector, type SelectorDescriptor, type SelectorTier } from '../core/self-healing-selector.js';

/**
 * Maps compact CLI `--device` aliases to Playwright's official device
 * descriptor keys. Playwright's bundled device list changes between
 * releases and does not carry every real-world device name (e.g. there is
 * no exact `'Galaxy S21'` entry in @playwright/test 1.44) — `GalaxyS21` maps
 * to the nearest available Samsung phone descriptor instead.
 */
const DEVICE_ALIASES: Record<string, string> = {
  iphone14: 'iPhone 14',
  iphonese: 'iPhone SE',
  pixel7: 'Pixel 7',
  galaxys21: 'Galaxy S24',
  ipad: 'iPad (gen 7)'
};

/** The list of CLI-facing device names supported out of the box. */
export const SUPPORTED_DEVICES = Object.keys(DEVICE_ALIASES);

/** Resolves a CLI device name (alias or exact Playwright key) to a Playwright device key, or undefined if unknown. */
export function resolveDeviceKey(device: string): string | undefined {
  const alias = DEVICE_ALIASES[device.toLowerCase().replace(/\s+/g, '')];
  if (alias) {
    return alias;
  }
  return device in devices ? device : undefined;
}

/** Options accepted by {@link runMobileTest}. */
export interface MobileRunnerOptions {
  /** Target URL to visit. */
  url: string;
  /** Device to emulate: a supported alias (e.g. `iPhone14`) or an exact Playwright device key (e.g. `iPhone 14`). */
  device: string;
  /** Directory to write the screenshot into. Defaults to './screenshots'. */
  screenshotDir?: string;
  /** When set, resolves this element via the self-healing 5-tier fallback after navigation. */
  selector?: SelectorDescriptor;
}

/** Outcome of a single mobile emulation test run. */
export interface MobileRunResult {
  /** PASS if the page loaded and returned a non-empty title, FAIL otherwise. */
  status: 'PASS' | 'FAIL';
  /** The URL that was tested. */
  url: string;
  /** The Playwright device descriptor key that was emulated. */
  device: string;
  /** The page title captured, when available. */
  title?: string;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs: number;
  /** Path to the screenshot written to disk, when available. */
  screenshotPath?: string;
  /** The fallback tier that resolved {@link MobileRunnerOptions.selector}, when one was configured. */
  selectorTier?: SelectorTier;
  /** Error message, populated only when status is FAIL. */
  error?: string;
}

/** Builds a filesystem-safe screenshot filename from a device name, URL, and timestamp. */
function screenshotFileName(device: string, url: string): string {
  const safeDevice = device.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const safeUrl = url.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${Date.now()}-${safeDevice}-${safeUrl}.png`;
}

/**
 * Runs a headless Playwright browser test against a URL under emulation of a mobile device.
 * Navigates to the URL, captures a screenshot, and asserts the page has a title.
 * Never throws — unknown devices, navigation, and assertion failures are all reported as a FAIL result.
 *
 * @param options - Target URL, device to emulate, and optional screenshot directory.
 * @returns The PASS/FAIL result with duration and screenshot path.
 */
export async function runMobileTest(options: MobileRunnerOptions): Promise<MobileRunResult> {
  const { url } = options;
  const screenshotDir = options.screenshotDir ?? './screenshots';
  const startedAt = Date.now();

  const deviceKey = resolveDeviceKey(options.device);
  if (!deviceKey) {
    const durationMs = Date.now() - startedAt;
    const error = `Unknown device "${options.device}". Supported: ${SUPPORTED_DEVICES.join(', ')}`;
    log.error('Mobile run failed', undefined);
    return { status: 'FAIL', url, device: options.device, durationMs, error };
  }

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    log.info('Launching headless browser with device emulation', { url, device: deviceKey });
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ ...devices[deviceKey] });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'load' });
    const title = await page.title();

    let selectorTier: SelectorTier | undefined;
    if (options.selector) {
      try {
        const resolved = await resolveSelector(page, options.selector);
        selectorTier = resolved.tier;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        log.error('Mobile run failed: selector could not be resolved', err);
        return { status: 'FAIL', url, device: deviceKey, title, durationMs, error: message };
      }
    }

    await mkdir(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, screenshotFileName(deviceKey, url));
    await page.screenshot({ path: screenshotPath });

    const durationMs = Date.now() - startedAt;

    if (!title) {
      log.error('Mobile run failed: page has no title', undefined);
      return { status: 'FAIL', url, device: deviceKey, title, durationMs, screenshotPath, selectorTier, error: 'Page title is empty' };
    }

    log.success('Mobile run passed', { url, device: deviceKey, title, durationMs, screenshotPath });
    return { status: 'PASS', url, device: deviceKey, title, durationMs, screenshotPath, selectorTier };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    log.error('Mobile run failed', err);
    return { status: 'FAIL', url, device: deviceKey, durationMs, error: message };
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (err) {
        log.warn('Mobile run: failed to close context cleanly', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        log.warn('Mobile run: failed to close browser cleanly', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
}
