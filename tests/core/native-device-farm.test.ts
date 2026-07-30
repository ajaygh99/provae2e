import {
  prepareNativeDeviceFarm,
  redactNativeDeviceFarmRuntime
} from '../../src/core/native-device-farm';

describe('native Appium device farms', () => {
  it('prepares BrowserStack native capabilities without credentials in the URL', () => {
    const runtime = prepareNativeDeviceFarm({
      provider: 'browserstack',
      username: 'user',
      accessKey: 'secret',
      app: 'bs://app-26',
      project: 'PROVA',
      build: 'phase4',
      name: 'native proof'
    });
    expect(runtime.endpoint).toBe('https://hub-cloud.browserstack.com/wd/hub');
    expect(runtime.endpoint).not.toContain('secret');
    expect(runtime.capabilities['bstack:options']).toEqual({
      projectName: 'PROVA',
      buildName: 'phase4',
      sessionName: 'native proof'
    });
  });

  it.each([
    ['us-west-1', 'ondemand.us-west-1.saucelabs.com'],
    ['us-east-4', 'ondemand.us-east-4.saucelabs.com'],
    ['eu-central-1', 'ondemand.eu-central-1.saucelabs.com']
  ] as const)('maps Sauce region %s to its fixed host', (sauceRegion, host) => {
    const runtime = prepareNativeDeviceFarm({
      provider: 'saucelabs',
      username: 'user',
      accessKey: 'key',
      app: 'storage:filename=prova.apk',
      sauceRegion
    });
    expect(runtime.endpoint).toContain(host);
  });

  it('rejects malformed app references and credential injection', () => {
    expect(() => prepareNativeDeviceFarm({
      provider: 'browserstack', username: 'user', accessKey: 'key', app: 'https://example.test/app.apk'
    })).toThrow('bs://');
    expect(() => prepareNativeDeviceFarm({
      provider: 'saucelabs', username: 'user\nInjected', accessKey: 'key', app: 'storage:filename=app.apk'
    })).toThrow('safe characters');
  });

  it('removes authorization from evidence-safe runtime details', () => {
    const runtime = prepareNativeDeviceFarm({
      provider: 'browserstack', username: 'user', accessKey: 'top-secret', app: 'bs://app'
    });
    const evidence = redactNativeDeviceFarmRuntime(runtime);
    expect(evidence).not.toHaveProperty('authorization');
    expect(JSON.stringify(evidence)).not.toContain('top-secret');
  });
});
