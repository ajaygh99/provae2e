import {
  changeNativePermissions,
  nativeConsentCapabilities,
  validateNativePermissionRequest
} from '../../src/core/native-appium-permissions';
import type { AppiumFetch } from '../../src/core/native-appium-runner';

describe('native Appium permissions', () => {
  const request = {
    appPackage: 'com.prova.demo',
    permissions: ['android.permission.CAMERA', 'android.permission.ACCESS_FINE_LOCATION'],
    action: 'grant' as const
  };

  it('validates bounded package and permission names', () => {
    expect(validateNativePermissionRequest(request)).toEqual(request);
    expect(() => validateNativePermissionRequest({ ...request, appPackage: '../unsafe' }))
      .toThrow('package');
    expect(() => validateNativePermissionRequest({ ...request, permissions: [] }))
      .toThrow('between 1 and 50');
    expect(() => validateNativePermissionRequest({
      ...request, permissions: ['android.permission.CAMERA', 'android.permission.CAMERA']
    })).toThrow('duplicates');
  });

  it('defaults consent automation off and enables it only explicitly', () => {
    expect(nativeConsentCapabilities()).toEqual({ 'appium:autoGrantPermissions': false });
    expect(nativeConsentCapabilities(true)).toEqual({ 'appium:autoGrantPermissions': true });
  });

  it.each(['grant', 'revoke'] as const)('executes an explicit %s action', async (action) => {
    let payload: unknown;
    const fetcher: AppiumFetch = jest.fn(async (_input, init) => {
      payload = JSON.parse(init?.body ?? '{}');
      return { ok: true, status: 200, json: async () => ({ value: null }) };
    });
    await changeNativePermissions('http://localhost:4723/', 'session/27', { ...request, action }, fetcher);
    expect(payload).toEqual({
      script: 'mobile: changePermissions',
      args: [{ ...request, action }]
    });
  });

  it('reports provider failures deterministically', async () => {
    const fetcher: AppiumFetch = jest.fn(async () => ({
      ok: false, status: 403, json: async () => ({})
    }));
    await expect(changeNativePermissions(
      'http://localhost:4723', 'session', request, fetcher
    )).rejects.toThrow('grant failed with HTTP 403');
  });
});
