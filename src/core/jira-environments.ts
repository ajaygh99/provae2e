/** Connection details for one named JIRA instance. */
export interface JiraEnvironment {
  baseUrl: string;
  cloudId?: string;
}

/** Named JIRA instance collection, commonly dev/qe/staging. */
export type JiraEnvironments = Record<string, JiraEnvironment>;

function validUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Parses the JIRA_ENVIRONMENTS JSON object without exposing credentials. */
export function parseJiraEnvironments(value: string): JiraEnvironments {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('JIRA_ENVIRONMENTS must be valid JSON'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JIRA_ENVIRONMENTS must be a JSON object');
  }
  const result: JiraEnvironments = {};
  for (const [name, config] of Object.entries(parsed)) {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new Error(`JIRA environment "${name}" must be an object`);
    }
    const record = config as Record<string, unknown>;
    if (!validUrl(record['baseUrl'])) throw new Error(`JIRA environment "${name}" has an invalid baseUrl`);
    if (record['cloudId'] !== undefined && (typeof record['cloudId'] !== 'string' || !record['cloudId'].trim())) {
      throw new Error(`JIRA environment "${name}" has an invalid cloudId`);
    }
    result[name] = { baseUrl: record['baseUrl'].replace(/\/+$/, ''), cloudId: record['cloudId'] as string | undefined };
  }
  return result;
}

/** Resolves a named JIRA environment or reports the available names. */
export function resolveJiraEnvironment(environments: JiraEnvironments, name: string): JiraEnvironment {
  const environment = environments[name];
  if (!environment) throw new Error(`Unknown JIRA environment "${name}". Available: ${Object.keys(environments).join(', ') || 'none'}`);
  return environment;
}
