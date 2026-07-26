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
import { executeWithRetry } from '../core/retry-handler.js';
import { BrowserStackConnector } from '../core/browserstack-connector.js';
import type {
  CloudDevice,
  DeviceCloudConfig,
  DeviceCloudProvider
} from '../core/device-cloud-provider.js';

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
  /** Retry count after the initial attempt. Defaults to 0 for programmatic use. */
  retries?: number;
  /** Initial exponential-backoff delay. Defaults to 1000ms. */
  retryBaseDelayMs?: number;
  /** Verification depth selected by the CLI. */
  scope?: 'smoke' | 'cr' | 'component' | 'full';
  /** Optional real-device provider. Local Playwright emulation remains the default. */
  deviceCloud?: 'local' | 'browserstack';
  /** BrowserStack credentials and execution settings, required for BrowserStack runs. */
  browserstack?: DeviceCloudConfig;
  /** Provider injection point for contract tests and custom orchestration. */
  cloudProvider?: DeviceCloudProvider;
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
  /** Checks completed by the selected scope. */
  checks?: string[];
  /** Device-cloud provider name for real-device runs. */
  provider?: string;
  /** Provider session identifier used to audit real-device evidence. */
  sessionId?: string;
  /** Provider-hosted video URL, when available. */
  videoUrl?: string;
  /** Provider-hosted log URLs, when available. */
  logUrls?: string[];
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
async function runMobileTestOnce(options: MobileRunnerOptions): Promise<MobileRunResult> {
  if (options.deviceCloud === 'browserstack' || options.cloudProvider) {
    return runCloudMobileTestOnce(options);
  }
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

    const pageErrors: string[] = [];
    page.on?.('pageerror', (error) => pageErrors.push(error.message));
    const response = await page.goto(url, { waitUntil: 'load' });
    const title = await page.title();
    const scope = options.scope ?? 'smoke';
    const checks = ['page loaded', 'non-empty title', `emulated ${deviceKey}`];

    if (scope === 'component' || scope === 'cr' || scope === 'full') {
      if ((await page.locator('body').count()) === 0) {
        return {
          status: 'FAIL',
          url,
          device: deviceKey,
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
          device: deviceKey,
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
          device: deviceKey,
          title,
          durationMs: Date.now() - startedAt,
          checks,
          error: `Uncaught page error: ${pageErrors[0]}`
        };
      }
      const hasHorizontalOverflow = await page.evaluate<boolean>(
        'document.documentElement.scrollWidth > window.innerWidth + 1'
      );
      if (hasHorizontalOverflow) {
        return {
          status: 'FAIL',
          url,
          device: deviceKey,
          title,
          durationMs: Date.now() - startedAt,
          checks,
          error: 'Responsive layout has horizontal viewport overflow'
        };
      }
      checks.push('no uncaught page errors', 'no horizontal viewport overflow');
    }

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
      return {
        status: 'FAIL',
        url,
        device: deviceKey,
        title,
        durationMs,
        screenshotPath,
        selectorTier,
        checks,
        error: 'Page title is empty'
      };
    }

    log.success('Mobile run passed', { url, device: deviceKey, title, durationMs, screenshotPath });
    return { status: 'PASS', url, device: deviceKey, title, durationMs, screenshotPath, selectorTier, checks };
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

function compactDeviceName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function selectCloudDevice(devicesAvailable: CloudDevice[], requested: string): CloudDevice | undefined {
  const requestedKey = compactDeviceName(resolveDeviceKey(requested) ?? requested);
  return devicesAvailable.find((device) => {
    const nameKey = compactDeviceName(device.name);
    const idKey = compactDeviceName(device.id);
    return (
      nameKey === requestedKey ||
      nameKey.endsWith(requestedKey) ||
      requestedKey.endsWith(nameKey) ||
      idKey === requestedKey
    );
  });
}

/** Executes the same mobile navigation contract on an explicitly selected real-device provider. */
async function runCloudMobileTestOnce(options: MobileRunnerOptions): Promise<MobileRunResult> {
  const startedAt = Date.now();
  const provider = options.cloudProvider ?? new BrowserStackConnector();
  if (!options.browserstack) {
    return {
      status: 'FAIL',
      url: options.url,
      device: options.device,
      durationMs: Date.now() - startedAt,
      error: 'BrowserStack configuration is required for a device-cloud run'
    };
  }

  let sessionId: string | undefined;
  try {
    await provider.initialize(options.browserstack);
    const availableDevices = await provider.listDevices();
    const device = selectCloudDevice(availableDevices, options.device);
    if (!device) {
      return {
        status: 'FAIL',
        url: options.url,
        device: options.device,
        durationMs: Date.now() - startedAt,
        error: `Device "${options.device}" is not available from ${provider.name}`
      };
    }
    const session = await provider.createSession(device);
    sessionId = session.id;
    const result = await provider.executeTest(session, {
      url: options.url,
      scope: options.scope ?? 'smoke'
    });
    return {
      status: result.status,
      url: result.url,
      device: result.device,
      durationMs: result.durationMs,
      ...(result.title !== undefined ? { title: result.title } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.artifacts?.screenshotPaths?.[0]
        ? { screenshotPath: result.artifacts.screenshotPaths[0] }
        : {}),
      provider: provider.name,
      sessionId: result.sessionId,
      ...(result.artifacts?.videoUrl ? { videoUrl: result.artifacts.videoUrl } : {}),
      ...(result.artifacts?.logs.length ? { logUrls: result.artifacts.logs } : {}),
      checks: [
        'real device session created',
        ...(result.title ? ['non-empty title'] : []),
        ...(result.artifacts?.videoUrl ? ['video captured'] : []),
        ...(result.artifacts?.logs.length ? ['logs captured'] : [])
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Device-cloud mobile run failed', error);
    return {
      status: 'FAIL',
      url: options.url,
      device: options.device,
      durationMs: Date.now() - startedAt,
      error: message
    };
  } finally {
    if (sessionId) {
      try {
        await provider.closeSession(sessionId);
      } catch (error) {
        log.warn('Device-cloud run: failed to close session cleanly', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}

/** Runs a mobile test and retries failed results using exponential backoff. */
export async function runMobileTest(options: MobileRunnerOptions): Promise<MobileRunResult> {
  return executeWithRetry(() => runMobileTestOnce(options), {
    maxRetries: options.retries ?? 0,
    baseDelayMs: options.retryBaseDelayMs ?? 1000,
    shouldRetry: (result) => result.status === 'FAIL'
  });
}
