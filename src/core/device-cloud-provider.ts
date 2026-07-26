/** Operating systems supported by mobile device-cloud providers. */
export type MobileOperatingSystem = 'ios' | 'android';

/** Normalized device metadata returned by a device-cloud provider. */
export interface CloudDevice {
  id: string;
  name: string;
  osName: MobileOperatingSystem;
  osVersion: string;
  deviceType: 'phone' | 'tablet';
  realMobile: boolean;
}

/** Credentials and execution defaults shared by device-cloud providers. */
export interface DeviceCloudConfig {
  username: string;
  accessKey: string;
  projectName?: string;
  buildName?: string;
  parallel?: number;
  video?: boolean;
  timeoutMs?: number;
  artifactDir?: string;
}

/** Provider-owned session created for one device execution. */
export interface DeviceSession {
  id: string;
  device: CloudDevice;
  provider: string;
  startedAt: string;
  connectionUrl?: string;
}

/** A provider-neutral mobile navigation test. */
export interface DeviceCloudTest {
  url: string;
  name?: string;
  scope?: 'smoke' | 'component' | 'cr' | 'full';
}

/** Artifact links and structured logs associated with a cloud session. */
export interface DeviceSessionArtifacts {
  videoUrl?: string;
  screenshotUrls: string[];
  screenshotPaths?: string[];
  logs: string[];
}

/** Normalized result returned by a device-cloud execution. */
export interface DeviceCloudTestResult {
  status: 'PASS' | 'FAIL';
  url: string;
  device: string;
  sessionId: string;
  durationMs: number;
  title?: string;
  error?: string;
  artifacts?: DeviceSessionArtifacts;
}

/**
 * Contract implemented by real-device services.
 *
 * Providers must be safe to initialize more than once, must not expose
 * credentials in errors, and must make session cleanup idempotent.
 */
export interface DeviceCloudProvider {
  readonly name: string;
  readonly type: 'cloud';

  initialize(config: DeviceCloudConfig): Promise<void>;
  listDevices(): Promise<CloudDevice[]>;
  createSession(device: CloudDevice): Promise<DeviceSession>;
  executeTest(session: DeviceSession, test: DeviceCloudTest): Promise<DeviceCloudTestResult>;
  getSessionArtifacts(sessionId: string): Promise<DeviceSessionArtifacts>;
  closeSession(sessionId: string): Promise<void>;
}

/** Returns a bounded provider concurrency value. */
export function normalizeCloudParallel(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1 || value > 25) {
    throw new Error('Device-cloud parallelism must be an integer between 1 and 25');
  }
  return value;
}
