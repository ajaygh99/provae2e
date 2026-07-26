import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import axios, { type AxiosInstance } from 'axios';
import {
  normalizeCloudParallel,
  type CloudDevice,
  type DeviceCloudConfig,
  type DeviceCloudProvider,
  type DeviceCloudTest,
  type DeviceCloudTestResult,
  type DeviceSession,
  type DeviceSessionArtifacts
} from './device-cloud-provider.js';

const API_URL = 'https://api.browserstack.com';
const HUB_URL = 'https://hub-cloud.browserstack.com/wd/hub';

interface BrowserStackDevice {
  device?: string;
  os?: string;
  os_version?: string;
  real_mobile?: boolean | string;
}

interface WebDriverSessionResponse {
  value?: { sessionId?: string };
  sessionId?: string;
}

interface WebDriverValue<T> {
  value: T;
}

interface BrowserStackSessionDetails {
  automation_session?: {
    video_url?: string;
    logs?: string;
    browser_console_logs_url?: string;
  };
}

export interface BrowserStackConnectorClients {
  api?: AxiosInstance;
  hub?: AxiosInstance;
}

/**
 * BrowserStack real-mobile web connector using the W3C WebDriver protocol.
 * Credentials remain confined to authenticated clients and are never included
 * in returned errors or structured result data.
 */
export class BrowserStackConnector implements DeviceCloudProvider {
  readonly name = 'browserstack';
  readonly type = 'cloud' as const;

  private config?: DeviceCloudConfig;
  private api?: AxiosInstance;
  private hub?: AxiosInstance;
  private readonly injectedClients: BrowserStackConnectorClients;

  constructor(clients: BrowserStackConnectorClients = {}) {
    this.injectedClients = clients;
  }

  async initialize(config: DeviceCloudConfig): Promise<void> {
    if (!config.username.trim() || !config.accessKey.trim()) {
      throw new Error('BrowserStack username and access key are required');
    }
    normalizeCloudParallel(config.parallel);
    this.config = { ...config };
    const clientOptions = {
      auth: { username: config.username, password: config.accessKey },
      timeout: config.timeoutMs ?? 30_000
    };
    this.api = this.injectedClients.api ?? axios.create({ baseURL: API_URL, ...clientOptions });
    this.hub = this.injectedClients.hub ?? axios.create({ baseURL: HUB_URL, ...clientOptions });
  }

  async listDevices(): Promise<CloudDevice[]> {
    const api = this.requireApi();
    try {
      const response = await api.get<BrowserStackDevice[]>('/automate/browsers.json', {
        params: { flat: true }
      });
      const seen = new Set<string>();
      return response.data
        .filter((entry) => entry.device && this.isRealMobile(entry.real_mobile))
        .map((entry) => this.normalizeDevice(entry))
        .filter((device) => {
          if (seen.has(device.id)) return false;
          seen.add(device.id);
          return true;
        });
    } catch (error) {
      throw this.providerError('Unable to list BrowserStack devices', error);
    }
  }

  async createSession(device: CloudDevice): Promise<DeviceSession> {
    const hub = this.requireHub();
    const config = this.requireConfig();
    const bstackOptions: Record<string, unknown> = {
      userName: config.username,
      accessKey: config.accessKey,
      deviceName: device.name,
      osVersion: device.osVersion,
      realMobile: true,
      projectName: config.projectName ?? 'PROVA',
      buildName: config.buildName ?? 'PROVA device cloud',
      sessionName: `${device.name} mobile web`,
      video: config.video ?? true
    };
    const browserName = device.osName === 'ios' ? 'Safari' : 'Chrome';
    try {
      const response = await hub.post<WebDriverSessionResponse>('/session', {
        capabilities: {
          alwaysMatch: {
            browserName,
            'bstack:options': bstackOptions
          }
        }
      });
      const sessionId = response.data.value?.sessionId ?? response.data.sessionId;
      if (!sessionId) {
        throw new Error('BrowserStack did not return a WebDriver session ID');
      }
      return {
        id: sessionId,
        device,
        provider: this.name,
        startedAt: new Date().toISOString()
      };
    } catch (error) {
      throw this.providerError(`Unable to create BrowserStack session for ${device.name}`, error);
    }
  }

  async executeTest(session: DeviceSession, test: DeviceCloudTest): Promise<DeviceCloudTestResult> {
    const hub = this.requireHub();
    const startedAt = Date.now();
    try {
      await hub.post(`/session/${encodeURIComponent(session.id)}/url`, { url: test.url });
      const titleResponse = await hub.get<WebDriverValue<string>>(
        `/session/${encodeURIComponent(session.id)}/title`
      );
      const title = titleResponse.data.value;
      const screenshotArtifacts = await this.captureArtifacts(session.id);
      let remoteArtifacts: DeviceSessionArtifacts = { screenshotUrls: [], logs: [] };
      try {
        remoteArtifacts = await this.getSessionArtifacts(session.id);
      } catch {
        // BrowserStack may not finalize video/log metadata until the session closes.
      }
      const artifacts: DeviceSessionArtifacts = {
        ...remoteArtifacts,
        screenshotUrls: remoteArtifacts.screenshotUrls,
        screenshotPaths: screenshotArtifacts.screenshotPaths,
        logs: remoteArtifacts.logs
      };
      if (!title) {
        return {
          status: 'FAIL',
          url: test.url,
          device: session.device.name,
          sessionId: session.id,
          durationMs: Date.now() - startedAt,
          error: 'Page title is empty',
          artifacts
        };
      }
      return {
        status: 'PASS',
        url: test.url,
        device: session.device.name,
        sessionId: session.id,
        durationMs: Date.now() - startedAt,
        title,
        artifacts
      };
    } catch (error) {
      return {
        status: 'FAIL',
        url: test.url,
        device: session.device.name,
        sessionId: session.id,
        durationMs: Date.now() - startedAt,
        error: this.providerError('BrowserStack test execution failed', error).message
      };
    }
  }

  async getSessionArtifacts(sessionId: string): Promise<DeviceSessionArtifacts> {
    const api = this.requireApi();
    try {
      const response = await api.get<BrowserStackSessionDetails>(
        `/automate/sessions/${encodeURIComponent(sessionId)}.json`
      );
      const details = response.data.automation_session;
      return {
        ...(details?.video_url ? { videoUrl: details.video_url } : {}),
        screenshotUrls: [],
        logs: [details?.browser_console_logs_url, details?.logs].filter(
          (value): value is string => Boolean(value)
        )
      };
    } catch (error) {
      throw this.providerError('Unable to retrieve BrowserStack session artifacts', error);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const hub = this.requireHub();
    try {
      await hub.delete(`/session/${encodeURIComponent(sessionId)}`);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return;
      throw this.providerError('Unable to close BrowserStack session', error);
    }
  }

  private async captureArtifacts(sessionId: string): Promise<DeviceSessionArtifacts> {
    const hub = this.requireHub();
    const config = this.requireConfig();
    const screenshotPaths: string[] = [];
    try {
      const response = await hub.get<WebDriverValue<string>>(
        `/session/${encodeURIComponent(sessionId)}/screenshot`
      );
      if (response.data.value) {
        const artifactDir = config.artifactDir ?? './artifacts/browserstack';
        await mkdir(artifactDir, { recursive: true });
        const screenshotPath = path.join(artifactDir, `${sessionId}.png`);
        await writeFile(screenshotPath, Buffer.from(response.data.value, 'base64'));
        screenshotPaths.push(screenshotPath);
      }
    } catch {
      // A screenshot failure must not hide the primary test outcome.
    }
    return { screenshotUrls: [], screenshotPaths, logs: [] };
  }

  private normalizeDevice(entry: BrowserStackDevice): CloudDevice {
    const name = entry.device as string;
    const osName = entry.os?.toLowerCase() === 'ios' ? 'ios' : 'android';
    const osVersion = entry.os_version ?? 'latest';
    const id = `${osName}-${osVersion}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return {
      id,
      name,
      osName,
      osVersion,
      deviceType: /ipad|tablet|tab/i.test(name) ? 'tablet' : 'phone',
      realMobile: true
    };
  }

  private isRealMobile(value: BrowserStackDevice['real_mobile']): boolean {
    return value === true || value === 'true';
  }

  private requireConfig(): DeviceCloudConfig {
    if (!this.config) throw new Error('BrowserStack connector is not initialized');
    return this.config;
  }

  private requireApi(): AxiosInstance {
    this.requireConfig();
    if (!this.api) throw new Error('BrowserStack connector is not initialized');
    return this.api;
  }

  private requireHub(): AxiosInstance {
    this.requireConfig();
    if (!this.hub) throw new Error('BrowserStack connector is not initialized');
    return this.hub;
  }

  private providerError(message: string, error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      return new Error(status ? `${message} (HTTP ${status})` : message);
    }
    const detail = error instanceof Error ? this.redactCredentials(error.message) : '';
    return new Error(detail ? `${message}: ${detail}` : message);
  }

  private redactCredentials(value: string): string {
    const config = this.config;
    if (!config) return value;
    return [config.username, config.accessKey].reduce(
      (redacted, secret) => secret ? redacted.split(secret).join('[REDACTED]') : redacted,
      value
    );
  }
}
