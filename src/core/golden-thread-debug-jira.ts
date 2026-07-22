/** JIRA escalation for Golden Thread Stage 7 (Debug) root cause analysis. */
import axios from 'axios';
import { GoldenThreadLinker } from './golden-thread-linker.js';
import { type RootCauseAnalysis } from './golden-thread-debug.js';
import { type JiraConnectorOptions } from './jira-connector.js';
import { type GoldenThreadChain } from './golden-thread-store.js';

/** Options for JIRA bug escalation. */
export interface JiraEscalationOptions extends JiraConnectorOptions {
  golden_thread_linker: GoldenThreadLinker;
  project_key: string;
}

/** Result of creating a JIRA bug ticket. */
export type JiraEscalationResult = { ok: true; issue_key: string; issue_url: string } | { ok: false; error: string };

/**
 * Creates a JIRA bug ticket from a root cause analysis with full 7-stage evidence link.
 * @param analysis Root cause analysis from Stage 7
 * @param opts JIRA credentials and project info
 * @returns Issue key and URL, or error
 */
export async function escalateToBugTicket(
  analysis: RootCauseAnalysis,
  opts: JiraEscalationOptions
): Promise<JiraEscalationResult> {
  const chain = await opts.golden_thread_linker.getChain(analysis.golden_thread_id);
  if (!chain) {
    return { ok: false, error: `Golden Thread ${analysis.golden_thread_id} not found` };
  }

  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  if (!baseUrl) {
    return { ok: false, error: `Invalid JIRA base URL "${opts.baseUrl}"` };
  }

  const token = opts.accessToken || opts.apiToken;
  if (!token) {
    return { ok: false, error: 'JIRA authentication required (accessToken or apiToken)' };
  }

  const description = buildJiraDescription(analysis, chain);
  const summary = buildJiraSummary(analysis);
  const labels = ['golden-thread', analysis.classification, `confidence-${analysis.confidence}`];

  const payload = {
    fields: {
      project: { key: opts.project_key },
      issuetype: { name: 'Bug' },
      summary,
      description,
      labels
    }
  };

  try {
    const response = await axios.post(
      `${baseUrl}/rest/api/3/issue`,
      payload,
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        timeout: opts.timeoutMs ?? 30000
      }
    );

    const issueKey = (response.data as { key?: string }).key;
    if (!issueKey) {
      return { ok: false, error: 'JIRA did not return an issue key' };
    }

    const issueUrl = `${baseUrl}/browse/${issueKey}`;
    return { ok: true, issue_key: issueKey, issue_url: issueUrl };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        return { ok: false, error: `JIRA authentication failed (${status})` };
      }
      if (status === 400) {
        const message = (error.response?.data as { errorMessages?: string[] })?.errorMessages?.[0] ?? 'Bad request';
        return { ok: false, error: `JIRA validation error: ${message}` };
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to create JIRA issue: ${message}` };
  }
}

/**
 * Normalizes JIRA base URL to remove trailing slash.
 * @param url JIRA base URL
 * @returns Normalized URL or empty string if invalid
 */
function normalizeBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/**
 * Builds JIRA issue summary from root cause analysis.
 * @param analysis Root cause analysis
 * @returns Issue summary
 */
function buildJiraSummary(analysis: RootCauseAnalysis): string {
  const classification = analysis.classification;
  const errorMsg = analysis.prod_error.message.substring(0, 50);
  return `[${classification}] Production Issue: ${errorMsg}...`;
}

/**
 * Builds JIRA issue description with full 7-stage evidence chain.
 * @param analysis Root cause analysis
 * @param chain Complete Golden Thread chain
 * @returns ADF-formatted description
 */
function buildJiraDescription(analysis: RootCauseAnalysis, chain: GoldenThreadChain): string {
  const lines: string[] = [];

  lines.push('h2. Golden Thread Root Cause Analysis');
  lines.push('');

  lines.push('h3. Issue Summary');
  lines.push(`*Classification:* {{${analysis.classification}}}`);
  lines.push(`*Confidence:* {{${analysis.confidence}%}}`);
  lines.push(`*Error Message:* {{{${analysis.prod_error.message}}}}`);
  lines.push(`*Occurrences:* {{${analysis.prod_error.occurrence_count}}}`);
  lines.push(`*Affected Service:* {{${analysis.prod_error.affected_service}}}`);
  lines.push('');

  lines.push('h3. Diagnostic Questions');
  lines.push(`* *Was this scenario tested?* ${analysis.was_tested ? '✓ Yes' : '✗ No'}`);
  if (analysis.test_evidence_link) {
    lines.push(`  [Test Evidence|${analysis.test_evidence_link}]`);
  }
  lines.push(`* *Was the test actually passing in CI?* ${analysis.ci_run_link ? '✓ Yes' : '? Unknown'}`);
  if (analysis.ci_run_link) {
    lines.push(`  [CI Run|${analysis.ci_run_link}]`);
  }
  lines.push(`* *Did code change introduce this?* ${analysis.code_change_link ? '✓ Check commit' : '? Unknown'}`);
  if (analysis.code_change_link) {
    lines.push(`  [Commit Diff|${analysis.code_change_link}]`);
  }
  lines.push(`* *Is this a new issue or recurring?* ${analysis.issue_history.length > 0 ? '⚠ Recurring' : '✓ New'}`);
  if (analysis.issue_history.length > 0) {
    lines.push(`  Previous occurrences: {{${analysis.issue_history.length}}}`);
  }
  lines.push('');

  lines.push('h3. Root Cause');
  lines.push(analysis.diagnostic_summary);
  lines.push('');

  lines.push('h3. Golden Thread Chain');
  lines.push('|Stage|Name|Status|Artifact|');
  for (const stage of chain.stages) {
    const stageName = getStageNumber(stage.stage);
    const link = stage.artifact_url ? `[Link|${stage.artifact_url}]` : '-';
    lines.push(`|${stage.stage}|${stageName}|${stage.status}|${link}|`);
  }
  lines.push('');

  lines.push('h3. Recommended Action');
  lines.push(getRecommendedAction(analysis.classification));

  return lines.join('\n');
}

/**
 * Gets human-readable stage name from stage number.
 * @param stage Stage number 1-7
 * @returns Stage name
 */
function getStageNumber(stage: number): string {
  const names: Record<number, string> = {
    1: 'Spec',
    2: 'Test',
    3: 'Evidence',
    4: 'Build',
    5: 'Deploy',
    6: 'Monitor',
    7: 'Debug'
  };
  return names[stage] || 'Unknown';
}

/**
 * Gets recommended action based on root cause classification.
 * @param classification Root cause classification
 * @returns Recommended action text
 */
function getRecommendedAction(classification: string): string {
  switch (classification) {
    case 'TestGap':
      return '1. Write a test case covering this scenario\n2. Ensure test fails on current code\n3. Fix code to make test pass\n4. Add test to regression suite';
    case 'CodeBug':
      return '1. Locate the bug in the commit diff (Stage 4)\n2. Create a fix that makes the test pass\n3. Verify fix in staging environment\n4. Deploy to production\n5. Monitor for recurrence';
    case 'SpecGap':
      return '1. Review specification (Stage 1) for this scenario\n2. Add requirements for missing behavior\n3. Create test case for new requirement\n4. Implement feature\n5. Verify in production';
    case 'DeploymentIssue':
      return '1. Review deployment logs (Stage 5) for errors\n2. Check infrastructure configuration\n3. Verify rollback procedure\n4. Re-deploy with corrected configuration\n5. Verify in production';
    default:
      return 'Please review all 7 stages of the Golden Thread to identify the root cause.';
  }
}
