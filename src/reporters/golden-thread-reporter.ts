/** Golden Thread chain HTML and JSON report generation. */
import { type GoldenThreadChain, STAGE_NAMES } from '../core/golden-thread-store.js';

/** Options for generating a report. */
export interface ReportOptions {
  title?: string;
  includeMetadata?: boolean;
  darkMode?: boolean;
}

/**
 * Generates an HTML report for a Golden Thread chain.
 * @param chain The complete chain with all 7 stages
 * @param opts Report generation options
 * @returns HTML string
 */
export function generateHtmlReport(chain: GoldenThreadChain, opts: ReportOptions = {}): string {
  const { title = 'Golden Thread', includeMetadata = true, darkMode = false } = opts;
  const bgColor = darkMode ? '#1e1e1e' : '#ffffff';
  const textColor = darkMode ? '#e0e0e0' : '#333333';
  const borderColor = darkMode ? '#444444' : '#ddd';
  const successColor = '#4caf50';
  const failColor = '#f44336';

  let stagesHtml = '';
  for (let i = 1; i <= 7; i++) {
    const stage = chain.stages.find(s => s.stage === i);
    const stageName = STAGE_NAMES[i as keyof typeof STAGE_NAMES];
    const statusColor = stage?.status === 'FAILED' ? failColor : stage?.status === 'PASSED' ? successColor : '#ffb74d';

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
          ${stage?.artifact_url ? `<p><strong>Artifact:</strong> <a href="${escapeHtml(stage.artifact_url)}" target="_blank">${escapeHtml(stage.artifact_url)}</a></p>` : ''}
          ${includeMetadata && stage?.metadata ? `<p><strong>Metadata:</strong> <pre>${escapeHtml(stage.metadata)}</pre></p>` : ''}
        </div>
      </div>
      ${i < 7 ? '<div class="connector"></div>' : ''}
    `;
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
      margin-bottom: 30px;
      font-size: 2em;
    }
    .thread-id {
      text-align: center;
      font-size: 0.9em;
      opacity: 0.7;
      margin-bottom: 30px;
      font-family: monospace;
    }
    .stages {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
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
    .stage-content pre {
      background: ${darkMode ? '#1a1a1a' : '#f0f0f0'};
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.9em;
    }
    .connector {
      width: 2px;
      height: 20px;
      background: ${borderColor};
      margin: 0 auto;
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
    <div class="stages">
      ${stagesHtml}
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates a JSON representation of the chain for programmatic use.
 * @param chain The complete chain
 * @returns JSON string
 */
export function generateJsonReport(chain: GoldenThreadChain): string {
  return JSON.stringify(chain, null, 2);
}

/**
 * Escapes HTML special characters to prevent XSS.
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
