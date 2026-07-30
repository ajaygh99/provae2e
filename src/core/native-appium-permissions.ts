import type { AppiumFetch } from './native-appium-runner.js';

export type PermissionAction = 'grant' | 'revoke';

export interface NativePermissionRequest {
  appPackage: string;
  permissions: string[];
  action: PermissionAction;
}

const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const PERMISSION_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

export function validateNativePermissionRequest(request: NativePermissionRequest): NativePermissionRequest {
  if (!PACKAGE_PATTERN.test(request.appPackage) || request.appPackage.length > 255) {
    throw new Error('Invalid Android application package');
  }
  if (request.permissions.length === 0 || request.permissions.length > 50) {
    throw new Error('Permission request must contain between 1 and 50 permissions');
  }
  const permissions = request.permissions.map((permission) => permission.trim());
  if (permissions.some((permission) =>
    permission.length > 255 || !PERMISSION_PATTERN.test(permission))) {
    throw new Error('Invalid Android permission name');
  }
  if (new Set(permissions).size !== permissions.length) {
    throw new Error('Permission request must not contain duplicates');
  }
  return { ...request, permissions };
}

/** Explicitly changes Android permissions through Appium's execute endpoint. */
export async function changeNativePermissions(
  appiumUrl: string,
  sessionId: string,
  request: NativePermissionRequest,
  fetcher: AppiumFetch = fetch as AppiumFetch
): Promise<void> {
  const validated = validateNativePermissionRequest(request);
  const response = await fetcher(
    `${appiumUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(sessionId)}/execute/sync`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        script: 'mobile: changePermissions',
        args: [{
          appPackage: validated.appPackage,
          permissions: validated.permissions,
          action: validated.action
        }]
      })
    }
  );
  if (!response.ok) {
    throw new Error(`Native permission ${validated.action} failed with HTTP ${response.status}`);
  }
}

export function nativeConsentCapabilities(autoGrantPermissions = false): Record<string, boolean> {
  return { 'appium:autoGrantPermissions': autoGrantPermissions };
}
