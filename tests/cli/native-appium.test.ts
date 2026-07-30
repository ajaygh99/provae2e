jest.mock('../../src/core/native-appium-runner', () => ({
  runNativeAppiumSession: jest.fn()
}));
jest.mock('../../src/core/logger', () => ({
  log: {
    info: jest.fn(), warn: jest.fn(), success: jest.fn(), error: jest.fn()
  }
}));

import { buildProgram } from '../../src/cli/run';
import { runNativeAppiumSession } from '../../src/core/native-appium-runner';
import { log } from '../../src/core/logger';

const mockRunNativeAppiumSession = jest.mocked(runNativeAppiumSession);
const mockSuccess = jest.mocked(log.success);
const mockError = jest.mocked(log.error);

describe('native Appium CLI', () => {
  const previousExitCode = process.exitCode;

  afterEach(() => {
    jest.clearAllMocks();
    process.exitCode = previousExitCode;
  });

  it('passes explicit Android native inputs to the Appium runner', async () => {
    mockRunNativeAppiumSession.mockResolvedValue({
      status: 'PASS', platform: 'android', deviceName: 'Pixel_7_API_35',
      app: 'fixture.apk', durationMs: 10, sessionId: 'session-32'
    });
    await buildProgram().parseAsync([
      'node', 'qe-tool', 'native', '--app', 'fixture.apk',
      '--device', 'Pixel_7_API_35', '--appium-url', 'http://localhost:4723',
      '--platform-version', '15'
    ]);
    expect(mockRunNativeAppiumSession).toHaveBeenCalledWith({
      app: 'fixture.apk',
      deviceName: 'Pixel_7_API_35',
      appiumUrl: 'http://localhost:4723',
      platformVersion: '15'
    });
    expect(mockSuccess).toHaveBeenCalledWith(
      'Native Appium session proof passed',
      expect.objectContaining({ platform: 'android', sessionId: 'session-32' })
    );
  });

  it('sets a deterministic failure exit code', async () => {
    mockRunNativeAppiumSession.mockResolvedValue({
      status: 'FAIL', platform: 'android', deviceName: 'emulator',
      app: 'missing.apk', durationMs: 1, error: 'Android app is unavailable'
    });
    await buildProgram().parseAsync([
      'node', 'qe-tool', 'native', '--app', 'missing.apk', '--device', 'emulator'
    ]);
    expect(process.exitCode).toBe(1);
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Native Appium run failed'));
  });
});
