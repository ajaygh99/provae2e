import { containsSensitiveData, redactSensitiveData } from '../core/sensitive-data.js';

export type ApprovedIntegrationId = 'github' | 'jira' | 'slack';
export type IntegrationAction =
  | 'publish-check'
  | 'link-evidence'
  | 'ingest-requirement'
  | 'sync-result'
  | 'create-defect'
  | 'notify-release';

export interface IntegrationManifest {
  contractVersion: 1;
  id: ApprovedIntegrationId;
  owner: string;
  actions: IntegrationAction[];
  secretRefs: Record<string, string>;
  endpoint?: string;
  timeoutMs?: number;
}

export interface IntegrationHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  checkedAt: string;
  message?: string;
}

export interface IntegrationExecutionResult {
  status: 'success' | 'failure';
  action: IntegrationAction;
  externalId?: string;
  url?: string;
  message?: string;
}

const ACTIONS: Record<ApprovedIntegrationId, ReadonlySet<IntegrationAction>> = {
  github: new Set(['publish-check', 'link-evidence']),
  jira: new Set(['ingest-requirement', 'sync-result', 'create-defect']),
  slack: new Set(['notify-release'])
};
const SAFE_OWNER = /^[a-zA-Z0-9][a-zA-Z0-9 ._@/-]{0,127}$/;
const ENV_REF = /^env:[A-Z][A-Z0-9_]{0,127}$/;

export function validateIntegrationManifest(manifest: IntegrationManifest): IntegrationManifest {
  if (manifest.contractVersion !== 1) {
    throw new Error('Unsupported integration contract version');
  }
  if (!Object.hasOwn(ACTIONS, manifest.id)) {
    throw new Error('Integration is not in the approved allowlist');
  }
  if (!SAFE_OWNER.test(manifest.owner)) {
    throw new Error('Integration owner must be a safe 1 to 128 character identifier');
  }
  if (manifest.actions.length === 0 || manifest.actions.length > 8) {
    throw new Error('Integration must declare between 1 and 8 actions');
  }
  if (new Set(manifest.actions).size !== manifest.actions.length) {
    throw new Error('Integration actions must not contain duplicates');
  }
  for (const action of manifest.actions) {
    if (!ACTIONS[manifest.id].has(action)) {
      throw new Error(`Action ${action} is not approved for ${manifest.id}`);
    }
  }
  const secretEntries = Object.entries(manifest.secretRefs);
  if (secretEntries.length === 0 || secretEntries.length > 8) {
    throw new Error('Integration must declare between 1 and 8 secret references');
  }
  for (const [name, reference] of secretEntries) {
    if (!/^[a-z][a-zA-Z0-9]{0,63}$/.test(name) || !ENV_REF.test(reference)) {
      throw new Error('Integration secrets must use named env:VARIABLE references');
    }
    if (containsSensitiveData(reference)) {
      throw new Error('Inline integration secrets are forbidden');
    }
  }
  if (manifest.endpoint) {
    const endpoint = new URL(manifest.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
        endpoint.search || endpoint.hash) {
      throw new Error('Integration endpoint must be a credential-free HTTPS URL');
    }
  }
  const timeoutMs = manifest.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error('Integration timeout must be between 1000 and 30000 ms');
  }
  return structuredClone({ ...manifest, timeoutMs });
}

export function validateIntegrationInput(input: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(input);
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
    throw new Error('Integration input exceeds the 64 KiB limit');
  }
  if (containsSensitiveData(serialized)) {
    throw new Error('Integration input contains inline sensitive data');
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

/** Produces evidence-safe output even when a provider error contains credentials. */
export function sanitizeIntegrationResult(
  result: IntegrationExecutionResult
): IntegrationExecutionResult {
  return JSON.parse(redactSensitiveData(JSON.stringify(result))) as IntegrationExecutionResult;
}
