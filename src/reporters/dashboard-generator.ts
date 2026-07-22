/** Interactive HTML dashboard generator for Golden Thread. */
import type { GoldenThreadChain } from '../core/golden-thread-store.js';
import { STAGE_NAMES } from '../core/golden-thread-store.js';
import type { DashboardMetrics, DashboardFilter, ChainSummary } from '../core/dashboard-types.js';
import { toChainSummary } from './dashboard-aggregator.js';

interface DashboardOptions {
  title?: string;
  darkMode?: boolean;
  filters?: DashboardFilter;
}

/**
 * Generates interactive HTML dashboard.
 * @param chains All chains
 * @param metrics Computed metrics
 * @param opts Dashboard options
 * @returns HTML string
 */
export function generateDashboardHtml(
  chains: GoldenThreadChain[],
  metrics: DashboardMetrics,
  opts: DashboardOptions = {}
): string {
  const { title = 'Golden Thread Dashboard', darkMode = false } = opts;
  const bgColor = darkMode ? '#1a1a1a' : '#f5f5f5';
  const cardBg = darkMode ? '#2a2a2a' : '#ffffff';
  const textColor = darkMode ? '#e0e0e0' : '#333333';
  const borderColor = darkMode ? '#444444' : '#e0e0e0';

  const summaries = chains.map(toChainSummary);

  const metricsHtml = generateMetricsPanel(metrics);
  const gridHtml = generateChainsGrid(summaries);
  const modalHtml = generateDetailModals(chains);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: ${bgColor};
      color: ${textColor};
      line-height: 1.6;
      transition: background-color 0.3s;
    }
    .dashboard-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .dashboard-header h1 { font-size: 2.5em; margin-bottom: 5px; }
    .dashboard-header p { opacity: 0.9; font-size: 1.1em; }
    .dashboard-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }
    .metrics-panel {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .metric-card {
      background: ${cardBg};
      border: 1px solid ${borderColor};
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .metric-label { font-size: 0.9em; opacity: 0.7; margin-bottom: 8px; }
    .metric-value { font-size: 2em; font-weight: bold; color: #667eea; }
    .metric-unit { font-size: 0.8em; opacity: 0.6; margin-left: 4px; }
    .chains-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 15px;
    }
    .chain-card {
      background: ${cardBg};
      border: 1px solid ${borderColor};
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .chain-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .chain-header {
      padding: 15px;
      border-bottom: 1px solid ${borderColor};
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .chain-status {
      font-weight: bold;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .chain-status.pass { background: #4caf50; color: white; }
    .chain-status.fail { background: #f44336; color: white; }
    .chain-status.pending { background: #ffb74d; color: white; }
    .chain-timeline {
      display: flex;
      flex-direction: row;
      gap: 3px;
      padding: 15px;
      overflow-x: auto;
    }
    .stage-indicator {
      flex: 1;
      min-width: 30px;
      height: 30px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8em;
      font-weight: bold;
      color: white;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .stage-indicator:hover { transform: scale(1.1); }
    .stage-indicator.passed { background: #4caf50; }
    .stage-indicator.failed { background: #f44336; }
    .stage-indicator.pending { background: #b0bec5; }
    .stage-indicator.in-progress { background: #ffb74d; }
    .chain-footer {
      padding: 12px 15px;
      border-top: 1px solid ${borderColor};
      font-size: 0.85em;
      opacity: 0.7;
    }
    .modal {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      animation: fadeIn 0.3s;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: ${cardBg};
      margin: auto;
      padding: 30px;
      border-radius: 8px;
      max-width: 700px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.3s;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 1px solid ${borderColor};
    }
    .modal-close {
      background: none;
      border: none;
      font-size: 1.5em;
      cursor: pointer;
      color: ${textColor};
    }
    .stage-detail {
      margin-bottom: 20px;
      padding: 15px;
      background: ${darkMode ? '#1a1a1a' : '#f9f9f9'};
      border-radius: 4px;
      border-left: 4px solid #667eea;
    }
    .stage-detail-label { font-weight: bold; margin-bottom: 8px; }
    .stage-detail-value { opacity: 0.8; word-break: break-all; }
    .artifact-link {
      color: #667eea;
      text-decoration: none;
      word-break: break-all;
    }
    .artifact-link:hover { text-decoration: underline; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideIn {
      from { transform: translateY(-50px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @media (max-width: 768px) {
      .dashboard-header h1 { font-size: 1.8em; }
      .chains-grid { grid-template-columns: 1fr; }
      .metric-value { font-size: 1.5em; }
      .modal-content { max-width: 90vw; padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="dashboard-header">
    <h1>${escapeHtml(title)}</h1>
    <p>Tracking ${metrics.totalChains} chains • ${metrics.overallPassRate.toFixed(0)}% pass rate</p>
  </div>

  <div class="dashboard-container">
    ${metricsHtml}
    <h2 style="margin-top: 30px; margin-bottom: 15px;">Chains</h2>
    <div class="chains-grid">
      ${gridHtml}
    </div>
  </div>

  ${modalHtml}

  <script>
    function openModal(chainId) {
      const modal = document.getElementById('modal-' + chainId);
      if (modal) modal.classList.add('active');
    }

    function closeModal(chainId) {
      const modal = document.getElementById('modal-' + chainId);
      if (modal) modal.classList.remove('active');
    }

    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
      }
    });
  </script>
</body>
</html>`;
}

function generateMetricsPanel(metrics: DashboardMetrics): string {
  const passRateColor = metrics.overallPassRate >= 80 ? '#4caf50' : metrics.overallPassRate >= 50 ? '#ffb74d' : '#f44336';

  let failuresHtml = '';
  for (const failure of metrics.commonFailures.slice(0, 3)) {
    failuresHtml += `<div style="font-size: 0.85em; margin: 5px 0;">Stage ${failure.stage}: ${failure.count} failures</div>`;
  }

  return `
    <div class="metrics-panel">
      <div class="metric-card">
        <div class="metric-label">Total Chains</div>
        <div class="metric-value">${metrics.totalChains}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Overall Pass Rate</div>
        <div class="metric-value" style="color: ${passRateColor};">${metrics.overallPassRate.toFixed(1)}<span class="metric-unit">%</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Chain Duration</div>
        <div class="metric-value">${formatDuration(metrics.avgChainDuration)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Common Failures</div>
        <div style="font-size: 0.9em;">${failuresHtml || '<div style="opacity: 0.6;">No failures</div>'}</div>
      </div>
    </div>
  `;
}

function generateChainsGrid(summaries: ChainSummary[]): string {
  return summaries
    .map(summary => {
      const stagesHtml = summary.stages
        .map(s => {
          const statusClass = s.status === 'PASSED' ? 'passed' : s.status === 'FAILED' ? 'failed' : 'pending';
          return `<div class="stage-indicator ${statusClass}" title="Stage ${s.stage}: ${s.status}" onclick="openModal('${summary.id}')">${s.stage}</div>`;
        })
        .join('');

      return `
        <div class="chain-card" onclick="openModal('${summary.id}')">
          <div class="chain-header">
            <div style="flex: 1;">Chain ${summary.id.substring(0, 8)}</div>
            <div class="chain-status ${summary.status.toLowerCase()}">${summary.status}</div>
          </div>
          <div class="chain-timeline">${stagesHtml}</div>
          <div class="chain-footer">
            Duration: ${formatDuration(summary.duration)} ${summary.environment ? `• ${summary.environment}` : ''}
          </div>
        </div>
      `;
    })
    .join('');
}

function generateDetailModals(chains: GoldenThreadChain[]): string {
  return chains
    .map(chain => {
      const stageDivs = chain.stages
        .map(stage => {
          const stageName = STAGE_NAMES[stage.stage];
          const metadata = tryParseJson(stage.metadata);
          return `
            <div class="stage-detail">
              <div class="stage-detail-label">Stage ${stage.stage}: ${stageName}</div>
              <div style="font-size: 0.9em; margin: 8px 0;">
                <strong>Status:</strong> <span style="color: ${stage.status === 'PASSED' ? '#4caf50' : stage.status === 'FAILED' ? '#f44336' : '#ffb74d'};">${stage.status}</span>
              </div>
              <div style="font-size: 0.85em; margin: 8px 0;">
                <strong>Time:</strong> ${new Date(stage.timestamp).toLocaleString()}
              </div>
              <div style="font-size: 0.85em; margin: 8px 0;">
                <strong>Actor:</strong> ${escapeHtml(stage.actor)}
              </div>
              ${stage.artifact_url ? `<div style="font-size: 0.85em; margin: 8px 0;"><strong>Artifact:</strong> <a href="${escapeHtml(stage.artifact_url)}" class="artifact-link" target="_blank">${escapeHtml(stage.artifact_url)}</a></div>` : ''}
              ${metadata && Object.keys(metadata).length > 0 ? `<div style="font-size: 0.85em; margin: 8px 0;"><strong>Metadata:</strong> <pre style="background: #f0f0f0; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.8em;">${escapeHtml(JSON.stringify(metadata, null, 2))}</pre></div>` : ''}
            </div>
          `;
        })
        .join('');

      return `
        <div id="modal-${chain.golden_thread_id}" class="modal" onclick="closeModal('${chain.golden_thread_id}')">
          <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
              <h2>Chain ${chain.golden_thread_id}</h2>
              <button class="modal-close" onclick="closeModal('${chain.golden_thread_id}')">×</button>
            </div>
            <div style="margin-bottom: 15px; opacity: 0.8; font-size: 0.9em;">Created: ${new Date(chain.created_at).toLocaleString()}</div>
            ${stageDivs}
          </div>
        </div>
      `;
    })
    .join('');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function tryParseJson(jsonStr: string): Record<string, unknown> {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

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
