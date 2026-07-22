/** HTML report generation for Golden Thread Stage 7 (Debug) root cause analysis. */
import { type GoldenThreadChain, STAGE_NAMES } from '../core/golden-thread-store.js';
import { type RootCauseAnalysis } from '../core/golden-thread-debug.js';

/** Options for generating a debug report. */
export interface DebugReportOptions {
  title?: string;
  darkMode?: boolean;
  includeHistory?: boolean;
}

/**
 * Generates an HTML debug report for a Golden Thread chain with root cause analysis.
 * @param chain Complete 7-stage chain
 * @param analysis Root cause analysis from Stage 7
 * @param opts Report generation options
 * @returns HTML string
 */
export function generateDebugReport(
  chain: GoldenThreadChain,
  analysis: RootCauseAnalysis,
  opts: DebugReportOptions = {}
): string {
  const { title = 'Golden Thread Debug Report', darkMode = false, includeHistory = true } = opts;
  const bgColor = darkMode ? '#1e1e1e' : '#ffffff';
  const textColor = darkMode ? '#e0e0e0' : '#333333';
  const borderColor = darkMode ? '#444444' : '#ddd';
  const successColor = '#4caf50';
  const failColor = '#f44336';
  const warningColor = '#ffb74d';

  const classificationColors: Record<string, string> = {
    TestGap: '#ff9800',
    CodeBug: '#f44336',
    SpecGap: '#2196f3',
    DeploymentIssue: '#9c27b0'
  };

  const classificationColor = classificationColors[analysis.classification] || '#999';

  let stagesHtml = '';
  for (let i = 1; i <= 7; i++) {
    const stage = chain.stages.find(s => s.stage === i);
    const stageName = STAGE_NAMES[i as keyof typeof STAGE_NAMES];
    const statusColor = stage?.status === 'FAILED' ? failColor : stage?.status === 'PASSED' ? successColor : warningColor;

    stagesHtml += `
      <div class="stage">
        <div class="stage-header" style="background-color: ${statusColor};">
          <span class="stage-number">${i}</span>
          <span class="stage-name">${stageName}</span>
        </div>
        <div class="stage-content">
          <p><strong>Status:</strong> ${stage?.status || 'PENDING'}</p>
          <p><strong>Actor:</strong> ${stage?.actor || 'N/A'}</p>
          <p><strong>Timestamp:</strong> ${stage?.timestamp ? new Date(stage.timestamp).toLocaleString() : 'N/A'}</p>
          ${stage?.artifact_url ? `<p><strong>Artifact:</strong> <a href="${escapeHtml(stage.artifact_url)}" target="_blank">View Artifact</a></p>` : ''}
        </div>
      </div>
      ${i < 7 ? '<div class="connector"></div>' : ''}
    `;
  }

  let historyHtml = '';
  if (includeHistory && analysis.issue_history.length > 0) {
    historyHtml = `
      <div class="history-section">
        <h3>Incident History</h3>
        <p>This issue has occurred <strong>${analysis.issue_history.length}</strong> time(s) previously.</p>
        <ul>
    `;
    for (const incident of analysis.issue_history) {
      historyHtml += `
          <li>
            <strong>First seen:</strong> ${new Date(incident.first_seen).toLocaleString()}<br/>
            <strong>Last seen:</strong> ${new Date(incident.last_seen).toLocaleString()}<br/>
            <strong>Occurrences:</strong> ${incident.occurrence_count}
            ${incident.fixed_in_commit ? `<br/><strong>Fixed in:</strong> <code>${escapeHtml(incident.fixed_in_commit)}</code>` : ''}
          </li>
      `;
    }
    historyHtml += `
        </ul>
      </div>
    `;
  }

  let linksHtml = '';
  if (analysis.test_evidence_link) {
    linksHtml += `<p><a href="${escapeHtml(analysis.test_evidence_link)}" target="_blank">View Test Evidence</a></p>`;
  }
  if (analysis.ci_run_link) {
    linksHtml += `<p><a href="${escapeHtml(analysis.ci_run_link)}" target="_blank">View CI Run</a></p>`;
  }
  if (analysis.code_change_link) {
    linksHtml += `<p><a href="${escapeHtml(analysis.code_change_link)}" target="_blank">View Code Change</a></p>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background-color: ${bgColor};
      color: ${textColor};
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    h1 {
      text-align: center;
      margin-bottom: 10px;
      font-size: 2em;
    }
    h2 {
      margin-top: 30px;
      margin-bottom: 15px;
      font-size: 1.5em;
      border-bottom: 2px solid ${classificationColor};
      padding-bottom: 10px;
    }
    h3 {
      margin-top: 20px;
      margin-bottom: 10px;
      font-size: 1.2em;
    }
    .thread-id {
      text-align: center;
      font-size: 0.9em;
      opacity: 0.7;
      margin-bottom: 30px;
      font-family: monospace;
    }
    .classification-box {
      background: ${classificationColor}33;
      border-left: 4px solid ${classificationColor};
      padding: 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .classification-label {
      font-size: 1.2em;
      font-weight: bold;
      color: ${classificationColor};
      margin-bottom: 10px;
    }
    .confidence-score {
      display: inline-block;
      background: ${classificationColor};
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: bold;
      margin-left: 10px;
    }
    .diagnostic-summary {
      background: ${darkMode ? '#2a2a2a' : '#f9f9f9'};
      padding: 15px;
      border-radius: 4px;
      margin: 15px 0;
      border-left: 4px solid ${classificationColor};
    }
    .qa-section {
      background: ${darkMode ? '#2a2a2a' : '#f9f9f9'};
      padding: 20px;
      border-radius: 4px;
      margin: 20px 0;
    }
    .qa-item {
      margin: 15px 0;
      padding: 10px;
      background: ${darkMode ? '#1a1a1a' : '#fff'};
      border-left: 4px solid #2196f3;
      border-radius: 4px;
    }
    .qa-question {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .qa-answer {
      color: ${darkMode ? '#b0b0b0' : '#666'};
      margin-left: 10px;
    }
    .stages {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
      margin: 30px 0;
    }
    .stage {
      width: 100%;
      max-width: 600px;
      border: 2px solid ${borderColor};
      border-radius: 8px;
      overflow: hidden;
      background: ${darkMode ? '#2a2a2a' : '#f9f9f9'};
    }
    .stage-header {
      padding: 15px;
      color: white;
      font-weight: bold;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .stage-number {
      font-size: 1.5em;
      font-weight: bold;
    }
    .stage-name {
      font-size: 1.1em;
    }
    .stage-content {
      padding: 15px;
    }
    .stage-content p {
      margin: 10px 0;
    }
    .stage-content a {
      color: #2196f3;
      text-decoration: none;
    }
    .stage-content a:hover {
      text-decoration: underline;
    }
    .connector {
      width: 2px;
      height: 20px;
      background: ${borderColor};
      margin: 0 auto;
    }
    .history-section {
      background: ${darkMode ? '#2a2a2a' : '#f9f9f9'};
      padding: 20px;
      border-radius: 4px;
      margin: 20px 0;
      border-left: 4px solid ${warningColor};
    }
    .history-section ul {
      margin-left: 20px;
      margin-top: 10px;
    }
    .history-section li {
      margin: 10px 0;
      padding: 10px;
      background: ${darkMode ? '#1a1a1a' : '#fff'};
      border-radius: 4px;
    }
    .links-section {
      background: ${darkMode ? '#2a2a2a' : '#f9f9f9'};
      padding: 20px;
      border-radius: 4px;
      margin: 20px 0;
    }
    .links-section p {
      margin: 10px 0;
    }
    .links-section a {
      display: inline-block;
      background: #2196f3;
      color: white;
      padding: 10px 15px;
      border-radius: 4px;
      text-decoration: none;
      margin-right: 10px;
    }
    .links-section a:hover {
      background: #1976d2;
    }
    .error-message {
      background: ${failColor}22;
      border-left: 4px solid ${failColor};
      padding: 15px;
      border-radius: 4px;
      margin: 15px 0;
      font-family: monospace;
      word-break: break-all;
    }
    code {
      background: ${darkMode ? '#2a2a2a' : '#f0f0f0'};
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }
    @media (max-width: 768px) {
      .stage {
        max-width: 100%;
      }
      h1 {
        font-size: 1.5em;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    <p class="thread-id">Thread ID: ${escapeHtml(chain.golden_thread_id)}</p>
    <p class="thread-id">Created: ${new Date(chain.created_at).toLocaleString()}</p>

    <div class="classification-box">
      <div class="classification-label">
        Root Cause: ${analysis.classification}
        <span class="confidence-score">${analysis.confidence}% Confidence</span>
      </div>
      <div class="diagnostic-summary">
        ${escapeHtml(analysis.diagnostic_summary)}
      </div>
    </div>

    <h2>Production Error</h2>
    <div class="error-message">
      <strong>Message:</strong> ${escapeHtml(analysis.prod_error.message)}<br/>
      <strong>Level:</strong> ${analysis.prod_error.level}<br/>
      <strong>Service:</strong> ${escapeHtml(analysis.prod_error.affected_service)}<br/>
      <strong>Occurrences:</strong> ${analysis.prod_error.occurrence_count}<br/>
      <strong>First Seen:</strong> ${new Date(analysis.prod_error.first_occurrence).toLocaleString()}<br/>
      <strong>Last Seen:</strong> ${new Date(analysis.prod_error.last_occurrence).toLocaleString()}
    </div>

    <h2>Diagnostic Questions</h2>
    <div class="qa-section">
      <div class="qa-item">
        <div class="qa-question">Was this scenario tested?</div>
        <div class="qa-answer">${analysis.was_tested ? '✓ Yes' : '✗ No'}</div>
      </div>
      <div class="qa-item">
        <div class="qa-question">Was the test actually passing in CI?</div>
        <div class="qa-answer">${analysis.ci_run_link ? '✓ Yes - ' : '? Unknown - '}${analysis.ci_run_link ? `<a href="${escapeHtml(analysis.ci_run_link)}" target="_blank">View CI Run</a>` : 'No CI link available'}</div>
      </div>
      <div class="qa-item">
        <div class="qa-question">Did code change introduce this?</div>
        <div class="qa-answer">${analysis.code_change_link ? '✓ Check commit - ' : '? Unknown - '}${analysis.code_change_link ? `<a href="${escapeHtml(analysis.code_change_link)}" target="_blank">View Commit Diff</a>` : 'No commit link available'}</div>
      </div>
      <div class="qa-item">
        <div class="qa-question">Is this a new issue or recurring?</div>
        <div class="qa-answer">${analysis.issue_history.length > 0 ? `⚠ Recurring (${analysis.issue_history.length} previous)` : '✓ New issue'}</div>
      </div>
    </div>

    ${historyHtml}

    <h2>Golden Thread Chain</h2>
    <div class="stages">
      ${stagesHtml}
    </div>

    ${linksHtml ? `
      <h2>Evidence Links</h2>
      <div class="links-section">
        ${linksHtml}
      </div>
    ` : ''}
  </div>
</body>
</html>`;
}

/**
 * Escapes HTML special characters to prevent XSS.
 * @param text Text to escape
 * @returns Escaped text
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}
