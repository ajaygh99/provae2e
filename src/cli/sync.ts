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

  const spinner = log.spinner(`Fetching JIRA issue ${options.jiraKey}...`);
  const description = await fetchJiraTicketDescription(connectorOptions);

  if (!description.ok) {
    spinner.fail(`${description.error}`); process.exitCode = 1; return;
  }
  spinner.succeed(`Fetched ${options.jiraKey}`);

  const linkSpinner = log.spinner('Parsing acceptance criteria and creating spec links...');
  const linkResult = await createSpecLinks({
    jiraIssueKey: options.jiraKey,
    specText: description.description,
    databasePath
  });

  if (!linkResult.ok) {
    linkSpinner.fail(`${linkResult.error}`); process.exitCode = 1; return;
  }
  linkSpinner.succeed(`Created ${linkResult.requirementCount} requirement links`);

  const validationSpinner = log.spinner('Validating test coverage...');
  const validation = await validateSpecLinks({
    jiraIssueKey: options.jiraKey,
    databasePath
  });

  if (!validation.ok) {
    validationSpinner.fail(`${validation.error}`); process.exitCode = 1; return;
  }
  validationSpinner.succeed(`Coverage validation complete`);

  log.info('');
  log.info(`📊 Spec Link Summary for ${options.jiraKey}`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`Total requirements: ${validation.totalRequirements}`);
  log.info(`Covered: ${validation.coveredRequirements}/${validation.totalRequirements}`);
  log.info(`Coverage: ${validation.coveragePercentage}%`);

  if (validation.uncoveredRequirements.length > 0) {
    log.warn('⚠️  Uncovered requirements:');
    validation.uncoveredRequirements.forEach((req) => {
      log.warn(`  • ${req}`);
    });
  } else {
    log.success('✓ All requirements have test coverage');
  }

  log.info(`Database: ${databasePath}`);
  log.info('');
}
