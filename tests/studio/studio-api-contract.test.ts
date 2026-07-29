import {
  STUDIO_API_PREFIX,
  STUDIO_TIMEOUT,
  isStudioRunRequest,
  normalizeStudioTimeout
} from '../../src/studio/studio-api-contract';

describe('Studio API contract', () => {
  it('uses a versioned route prefix', () => {
    expect(STUDIO_API_PREFIX).toBe('/api/studio/v1');
  });

  it('accepts an allow-listed run request', () => {
    expect(isStudioRunRequest({
      workspaceId: 'workspace_123',
      fileId: 'file_123456',
      browser: 'all',
      timeoutMs: 120_000
    })).toBe(true);
  });

  it.each([
    { workspaceId: '../secret', fileId: 'file_123456', browser: 'chromium', timeoutMs: 1_000 },
    { workspaceId: 'workspace_123', fileId: 'file_123456', browser: 'edge', timeoutMs: 1_000 },
    { workspaceId: 'workspace_123', fileId: 'file_123456', browser: 'chromium', timeoutMs: 999 },
    { workspaceId: 'workspace_123', fileId: 'file_123456', browser: 'chromium', timeoutMs: 1.5 },
    { workspaceId: 'workspace_123', fileId: 'file_123456', browser: 'chromium', timeoutMs: 1_000, command: 'rm' }
  ])('rejects unsafe or invalid request %#', request => {
    expect(isStudioRunRequest(request)).toBe(false);
  });

  it('defaults and validates timeout values', () => {
    expect(normalizeStudioTimeout(undefined)).toBe(STUDIO_TIMEOUT.defaultMs);
    expect(normalizeStudioTimeout(45_000)).toBe(45_000);
    expect(() => normalizeStudioTimeout('45000')).toThrow('timeoutMs');
    expect(() => normalizeStudioTimeout(STUDIO_TIMEOUT.maximumMs + 1)).toThrow('timeoutMs');
  });
});
