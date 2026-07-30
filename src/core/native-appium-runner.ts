import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_APK_BYTES = 2 * 1024 * 1024 * 1024;

export interface NativeAppiumOptions {
  app: string;
  deviceName: string;
  appiumUrl?: string;
  platformVersion?: string;
  automationName?: 'UiAutomator2';
}

export interface NativeAppiumResult {
  status: 'PASS' | 'FAIL';
  platform: 'android';
  deviceName: string;
  app: string;
  durationMs: number;
  sessionId?: string;
  error?: string;
}

export type AppiumFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface AppiumSessionResponse {
  value?: { sessionId?: unknown };
  sessionId?: unknown;
}

function redact(value: string): string {
  return value
    .replace(/([?&](?:access[_-]?key|token|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@');
}

function normalizeServerUrl(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Appium URL must use http or https');
  }
  parsed.username = '';
  parsed.password = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export async function resolveAndroidApp(app: string): Promise<string> {
  if (/^https:\/\//i.test(app)) {
    const parsed = new URL(app);
    if (parsed.username || parsed.password) {
      throw new Error('Remote app URL must not contain credentials');
    }
    return parsed.toString();
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(app)) {
    throw new Error('Remote app URL must use https');
  }

  const resolved = await realpath(path.resolve(app));
  const details = await stat(resolved);
  if (!details.isFile()) {
    throw new Error('Android app path must reference a file');
  }
  if (path.extname(resolved).toLowerCase() !== '.apk') {
    throw new Error('Android native proof requires an .apk file');
  }
  if (details.size <= 0 || details.size > MAX_APK_BYTES) {
    throw new Error('APK size must be between 1 byte and 2 GiB');
  }
  return resolved;
}

/** Creates and always cleans up one Android Appium session. */
export async function runNativeAppiumSession(
  options: NativeAppiumOptions,
  fetcher: AppiumFetch = fetch as AppiumFetch
): Promise<NativeAppiumResult> {
  const startedAt = Date.now();
  let sessionId: string | undefined;
  let app = redact(options.app);
  let serverUrl = '';

  try {
    app = await resolveAndroidApp(options.app);
    serverUrl = normalizeServerUrl(options.appiumUrl ?? 'http://127.0.0.1:4723');
    const capabilities = {
      platformName: 'Android',
      'appium:automationName': options.automationName ?? 'UiAutomator2',
      'appium:deviceName': options.deviceName,
      'appium:app': app,
      ...(options.platformVersion ? { 'appium:platformVersion': options.platformVersion } : {})
    };
    const response = await fetcher(`${serverUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: capabilities } })
    });
    const payload = (await response.json()) as AppiumSessionResponse;
    const candidate = payload.value?.sessionId ?? payload.sessionId;
    if (!response.ok || typeof candidate !== 'string' || candidate.length === 0) {
      throw new Error(`Appium session creation failed with HTTP ${response.status}`);
    }
    sessionId = candidate;
    return {
      status: 'PASS',
      platform: 'android',
      deviceName: options.deviceName,
      app: redact(app),
      durationMs: Date.now() - startedAt,
      sessionId
    };
  } catch (error) {
    return {
      status: 'FAIL',
      platform: 'android',
      deviceName: options.deviceName,
      app: redact(app),
      durationMs: Date.now() - startedAt,
      error: redact(error instanceof Error ? error.message : String(error))
    };
  } finally {
    if (sessionId && serverUrl) {
      try {
        await fetcher(`${serverUrl}/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      } catch {
        // Cleanup is best effort; the structured run result remains deterministic.
      }
    }
  }
}
