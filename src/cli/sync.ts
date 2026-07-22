/** CLI command for syncing spec requirements with test coverage. */
import { log } from '../core/logger.js';
import { fetchJiraTicketDescription } from '../core/jira-connector.js';
import { createSpecLinks, validateSpecLinks } from '../core/spec-linker.js';
import type { JiraConnectorOptions } from '../core/jira-connector.js';

/** Options for the sync command. */
export interface SyncCommandOptions {
  /** JIRA issue key, e.g., PROJ-123. */
  jiraKey: string;
  /** JIRA base URL, e.g., https://company.atlassian.net. */
  jiraUrl?: string;
  /** JIRA API token or OAuth2 access token. */
  jiraToken?: string;
  /** JIRA Cloud ID for OAuth2 flow. */
  jiraCloudId?: string;
  /** Path to spec link database. */
  database?: string;
}

/**
 * Syncs acceptance criteria from JIRA to the local spec-link database
 * and validates test coverage.
 *
 * @param options - JIRA connection and database options.
 */
export async function syncCommand(options: SyncCommandOptions): Promise<void> {
  const jiraUrl = options.jiraUrl || process.env['JIRA_URL'] || 'https://company.atlassian.net';
  const jiraToken = options.jiraToken || process.env['JIRA_API_TOKEN'] || process.env['JIRA_OAUTH_ACCESS_TOKEN'];
  const databasePath = options.database || './prova-spec-links.db';

  if (!options.jiraKey) {
    log.error('--jira-key is required'); process.exitCode = 1; return;
  }

  if (!jiraToken) {
    log.error('JIRA_API_TOKEN or JIRA_OAUTH_ACCESS_TOKEN is required'); process.exitCode = 1; return;
  }

  const connectorOptions: JiraConnectorOptions = {
    baseUrl: jiraUrl,
    ticketKey: options.jiraKey,
    ...(process.env['JIRA_OAUTH_ACCESS_TOKEN'] ? { accessToken: jiraToken, cloudId: options.jiraCloudId } : { apiToken: jiraToken })
  };

  log.info(`Fetching JIRA issue ${options.jiraKey}...`);
  const description = await fetchJiraTicketDescription(connectorOptions);

  if (!description.ok) {
    log.error(description.error); process.exitCode = 1; return;
  }
  log.success(`Fetched ${options.jiraKey}`);

  log.info('Parsing acceptance criteria and creating spec links...');
  const linkResult = await createSpecLinks({
    jiraIssueKey: options.jiraKey,
    specText: description.description,
    databasePath
  });

  if (!linkResult.ok) {
    log.error(linkResult.error); process.exitCode = 1; return;
  }
  log.success(`Created ${linkResult.requirementCount} requirement links`);

  log.info('Validating test coverage...');
  const validation = await validateSpecLinks({
    jiraIssueKey: options.jiraKey,
    databasePath
  });

  if (!validation.ok) {
    log.error(validation.error); process.exitCode = 1; return;
  }

  log.success('Coverage validation complete');

  log.info('');
  log.info(`Spec Link Summary for ${options.jiraKey}`, {
    totalRequirements: validation.totalRequirements,
    coveredRequirements: validation.coveredRequirements,
    coveragePercentage: validation.coveragePercentage
  });

  if (validation.uncoveredRequirements.length > 0) {
    for (const req of validation.uncoveredRequirements) {
      log.warn(`Uncovered requirement: ${req}`);
    }
  } else {
    log.success('All requirements have test coverage');
  }

  log.info(`Database: ${databasePath}`);
}
