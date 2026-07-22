/** JIRA integration for Golden Thread Spec stage. */
import { fetchJiraTicketDescription, type JiraConnectorOptions } from './jira-connector.js';
import { GoldenThreadLinker } from './golden-thread-linker.js';

/** Options for creating a Spec stage from a JIRA issue. */
export interface JiraSpecOptions extends JiraConnectorOptions {
  issue_key: string;
  golden_thread_linker: GoldenThreadLinker;
}

/**
 * Fetches a JIRA issue and initiates a Golden Thread chain with Spec stage.
 * @param opts Options including JIRA auth and issue key
 * @returns The generated golden_thread_id
 */
export async function initiateFromJira(opts: JiraSpecOptions): Promise<string> {
  const { issue_key, golden_thread_linker, ...jiraOpts } = opts;

  const ticketDescription = await fetchJiraTicketDescription({
    ...jiraOpts,
    ticketKey: issue_key
  });

  if (!ticketDescription.ok) {
    throw new Error(`Failed to fetch JIRA issue ${issue_key}: ${ticketDescription.error}`);
  }

  const baseUrl = jiraOpts.baseUrl.replace(/\/$/, '');
  const artifact_url = `${baseUrl}/browse/${issue_key}`;

  const golden_thread_id = await golden_thread_linker.initiateChain({
    actor: 'jira-connector',
    artifact_url,
    metadata: {
      issue_key,
      description: ticketDescription.description
    }
  });

  return golden_thread_id;
}
