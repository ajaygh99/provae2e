/** Versioned wire contract between the local Studio service and browser UI. */
export const STUDIO_API_VERSION = 'v1' as const;
export const STUDIO_API_PREFIX = `/api/studio/${STUDIO_API_VERSION}` as const;

export const STUDIO_BROWSERS = ['chromium', 'firefox', 'webkit', 'all'] as const;
export type StudioBrowser = typeof STUDIO_BROWSERS[number];

export const STUDIO_TEST_FORMATS = ['yaml', 'json'] as const;
export type StudioTestFormat = typeof STUDIO_TEST_FORMATS[number];

export type StudioErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'RUN_FAILED'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

export interface StudioApiError {
  error: {
    code: StudioErrorCode;
    message: string;
    requestId: string;
    details?: readonly StudioDiagnostic[];
  };
}

export interface StudioDiagnostic {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

export interface StudioHealth {
  status: 'ok';
  apiVersion: typeof STUDIO_API_VERSION;
  cliVersion: string;
}

/**
 * Opaque identifiers keep absolute filesystem paths out of browser responses.
 * The local service alone resolves an id to a path beneath the selected root.
 */
export interface StudioWorkspace {
  id: string;
  name: string;
  testFileCount: number;
}

export interface SelectWorkspaceRequest {
  path: string;
}

export interface StudioTestFile {
  id: string;
  workspaceId: string;
  name: string;
  relativePath: string;
  format: StudioTestFormat;
  updatedAt: string;
}

export interface StudioTestDocument extends StudioTestFile {
  content: string;
  revision: string;
  diagnostics: readonly StudioDiagnostic[];
}

export interface SaveStudioDocumentRequest {
  content: string;
  expectedRevision: string;
}

export interface StudioRunRequest {
  workspaceId: string;
  fileId: string;
  browser: StudioBrowser;
  timeoutMs: number;
}

export type StudioRunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled'
  | 'timed-out';

export interface StudioRunSummary {
  id: string;
  workspaceId: string;
  fileId: string;
  status: StudioRunStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  failureSummary?: string;
}

export type StudioRunEvent =
  | { type: 'status'; sequence: number; timestamp: string; status: StudioRunStatus }
  | { type: 'stdout' | 'stderr'; sequence: number; timestamp: string; text: string }
  | { type: 'evidence'; sequence: number; timestamp: string; evidence: StudioEvidence }
  | { type: 'complete'; sequence: number; timestamp: string; summary: StudioRunSummary };

export type StudioEvidenceKind = 'screenshot' | 'trace' | 'log' | 'report';

export interface StudioEvidence {
  id: string;
  runId: string;
  kind: StudioEvidenceKind;
  name: string;
  mediaType: string;
  size: number;
}

export const STUDIO_TIMEOUT = {
  defaultMs: 120_000,
  minimumMs: 1_000,
  maximumMs: 900_000
} as const;

/** Returns true only for the allow-listed, shell-free run request shape. */
export function isStudioRunRequest(value: unknown): value is StudioRunRequest {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set(['workspaceId', 'fileId', 'browser', 'timeoutMs']);
  return (
    Object.keys(value).every(key => allowedKeys.has(key)) &&
    isOpaqueId(value['workspaceId']) &&
    isOpaqueId(value['fileId']) &&
    typeof value['browser'] === 'string' &&
    (STUDIO_BROWSERS as readonly string[]).includes(value['browser']) &&
    typeof value['timeoutMs'] === 'number' &&
    Number.isInteger(value['timeoutMs']) &&
    value['timeoutMs'] >= STUDIO_TIMEOUT.minimumMs &&
    value['timeoutMs'] <= STUDIO_TIMEOUT.maximumMs
  );
}

/** Applies the documented default and bounds without accepting non-numeric input. */
export function normalizeStudioTimeout(value: unknown): number {
  if (value === undefined) return STUDIO_TIMEOUT.defaultMs;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < STUDIO_TIMEOUT.minimumMs ||
    value > STUDIO_TIMEOUT.maximumMs
  ) {
    throw new Error(
      `timeoutMs must be an integer between ${STUDIO_TIMEOUT.minimumMs} and ${STUDIO_TIMEOUT.maximumMs}`
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}
