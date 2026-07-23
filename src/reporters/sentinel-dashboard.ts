/**
 * Server-side HTML generator for the PROVA Sentinel Studio dashboard.
 *
 * Renders a {@link SentinelDashboardModel} into a single self-contained HTML
 * document: live-status big numbers, an incidents table with timeline and
 * impact, frequency-sorted test-coverage gaps, active alerts with severity and
 * age, selectable 24h/7d/30d latency/error trend charts, and action buttons
 * (view incident, create test for gap, page oncall). Follows the same
 * aggregator + generator pattern as `dashboard-generator.ts` and
 * `golden-thread-deploy-report.ts`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../core/logger.js';
import {
  TREND_RANGES,
  type ActiveAlert,
  type AlertSeverity,
  type DashboardIncident,
  type IncidentSeverity,
  type Recommendation,
  type SentinelDashboardModel,
  type ServiceHealth,
  type TestGap,
  type TrendRange,
  type TrendSeries
} from '../core/sentinel-dashboard-aggregator.js';

/** Options controlling dashboard rendering. */
export interface SentinelDashboardRenderOptions {
  /** Overrides the document title. */
  title?: string;
  /** Render in dark mode. Defaults to false. */
  darkMode?: boolean;
}

const HEALTH_COLOR: Record<ServiceHealth, string> = {
  healthy: '#22c55e',
  degraded: '#f59e0b',
  critical: '#ef4444'
};

const INCIDENT_SEVERITY_COLOR: Record<IncidentSeverity, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#6b7280'
};

const ALERT_SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6'
};

/** Escapes HTML special characters to prevent injection into the report. */
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

/** Builds the four live-status big-number cards. */
function statusCards(model: SentinelDashboardModel): string {
  const { status } = model;
  const cards: Array<{ label: string; value: string; unit?: string; color?: string }> = [
    { label: 'Traffic', value: status.trafficRpm.toLocaleString('en-US'), unit: 'req/min' },
    { label: 'Error Rate', value: status.errorRatePercent.toString(), unit: '%', color: HEALTH_COLOR[status.health] },
    { label: 'Latency (p95)', value: status.latencyMsP95.toLocaleString('en-US'), unit: 'ms' },
    { label: 'Uptime', value: status.uptimePercent.toString(), unit: '%' }
  ];
  return cards
    .map(
      card => `
      <div class="stat-card">
        <div class="stat-label">${escapeHtml(card.label)}</div>
        <div class="stat-value"${card.color ? ` style="color:${card.color};"` : ''}>${escapeHtml(card.value)}${card.unit ? `<span class="stat-unit">${escapeHtml(card.unit)}</span>` : ''}</div>
      </div>`
    )
    .join('');
}

/** Builds the incidents table body with timeline, impact and action buttons. */
function incidentRows(incidents: DashboardIncident[]): string {
  if (incidents.length === 0) {
    return '<tr><td colspan="6" class="empty">No incidents recorded</td></tr>';
  }
  return incidents
    .map(incident => {
      const timeline = incident.ongoing
        ? `${escapeHtml(incident.startedAt)} → ongoing`
        : `${escapeHtml(incident.startedAt)} → ${escapeHtml(incident.endedAt ?? '')}`;
      return `
      <tr>
        <td><span class="badge" style="background:${INCIDENT_SEVERITY_COLOR[incident.severity]};">${escapeHtml(incident.severity)}</span></td>
        <td>${escapeHtml(incident.title)}</td>
        <td class="mono">${timeline}</td>
        <td>${incident.durationMinutes} min${incident.ongoing ? ' (open)' : ''}</td>
        <td>${escapeHtml(incident.impactLabel)}</td>
        <td><button class="action" data-action="view-incident" data-incident="${escapeHtml(incident.id)}" onclick="sentinelAction('view-incident', '${escapeHtml(incident.id)}')">View</button></td>
      </tr>`;
    })
    .join('');
}

/** Builds the frequency-sorted test-gap table body with a create-test action. */
function gapRows(gaps: TestGap[]): string {
  if (gaps.length === 0) {
    return '<tr><td colspan="4" class="empty">No coverage gaps</td></tr>';
  }
  return gaps
    .map(
      gap => `
      <tr>
        <td>${escapeHtml(gap.pattern)}</td>
        <td>${gap.occurrences}</td>
        <td>${gap.coveragePercent}%</td>
        <td><button class="action" data-action="create-test" data-pattern="${escapeHtml(gap.pattern)}" onclick="sentinelAction('create-test', '${escapeHtml(gap.pattern)}')">Create test</button></td>
      </tr>`
    )
    .join('');
}

/** Builds the active-alerts list with severity, age and a page-oncall action. */
function alertItems(alerts: ActiveAlert[]): string {
  if (alerts.length === 0) {
    return '<div class="empty">No active alerts</div>';
  }
  return alerts
    .map(
      alert => `
      <div class="alert-item">
        <span class="badge" style="background:${ALERT_SEVERITY_COLOR[alert.severity]};">${escapeHtml(alert.severity)}</span>
        <span class="alert-title">${escapeHtml(alert.title)}</span>
        <span class="alert-age">${escapeHtml(alert.ageLabel)}</span>
        <button class="action" data-action="page-oncall" data-alert="${escapeHtml(alert.id)}" onclick="sentinelAction('page-oncall', '${escapeHtml(alert.id)}')">Page oncall</button>
      </div>`
    )
    .join('');
}

/** Builds an inline SVG polyline for one metric series, scaled to the viewbox. */
function sparkline(values: number[], max: number, color: string): string {
  const width = 600;
  const height = 120;
  if (values.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" class="spark" role="img" aria-label="no data"><text x="12" y="64" fill="currentColor" opacity="0.6">No data</text></svg>`;
  }
  const safeMax = max > 0 ? max : 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((value, index) => {
      const x = round(index * step);
      const y = round(height - (value / safeMax) * height);
      return `${x},${y}`;
    })
    .join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" class="spark" role="img" aria-label="trend"><polyline fill="none" stroke="${color}" stroke-width="2" points="${points}" /></svg>`;
}

/** Builds the selectable trend panels (one per range, toggled by buttons). */
function trendPanels(trends: Record<TrendRange, TrendSeries>): string {
  const buttons = TREND_RANGES.map(
    (range, index) =>
      `<button class="trend-btn${index === 0 ? ' active' : ''}" data-range="${range}" onclick="selectTrend('${range}')">${range}</button>`
  ).join('');

  const panels = TREND_RANGES.map((range, index) => {
    const series = trends[range];
    const latency = series.points.map(point => point.latencyMs);
    const errors = series.points.map(point => point.errorRatePercent);
    return `
      <div class="trend-panel${index === 0 ? ' active' : ''}" data-range="${range}">
        <div class="trend-chart">
          <div class="trend-heading">Latency (ms) — max ${series.maxLatencyMs}</div>
          ${sparkline(latency, series.maxLatencyMs, '#3b82f6')}
        </div>
        <div class="trend-chart">
          <div class="trend-heading">Error rate (%) — max ${series.maxErrorRatePercent}</div>
          ${sparkline(errors, series.maxErrorRatePercent, '#ef4444')}
        </div>
      </div>`;
  }).join('');

  return `<div class="trend-controls">${buttons}</div>${panels}`;
}

/** Builds the recommendation list. */
function recommendationItems(recommendations: Recommendation[]): string {
  if (recommendations.length === 0) {
    return '<div class="empty">No recommendations</div>';
  }
  return recommendations
    .map(
      rec => `
      <div class="rec-item">
        <span class="badge priority-${rec.priority}">${escapeHtml(rec.priority)}</span>
        <div><div class="rec-title">${escapeHtml(rec.title)}</div><div class="rec-detail">${escapeHtml(rec.detail)}</div></div>
      </div>`
    )
    .join('');
}

/**
 * Renders a Sentinel dashboard model as a self-contained HTML document.
 * @param model The aggregated dashboard view model.
 * @param options Rendering options (title, dark mode).
 * @returns HTML document string.
 */
export function generateSentinelDashboardHtml(
  model: SentinelDashboardModel,
  options: SentinelDashboardRenderOptions = {}
): string {
  const { darkMode = false } = options;
  const title = options.title ?? `Sentinel Studio — ${model.service}`;
  const bg = darkMode ? '#1a1a1a' : '#f5f7fa';
  const card = darkMode ? '#2a2a2a' : '#ffffff';
  const fg = darkMode ? '#e0e0e0' : '#1f2937';
  const border = darkMode ? '#444' : '#e5e7eb';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:${bg}; color:${fg}; line-height:1.5; }
    .header { background: linear-gradient(135deg, #0f766e 0%, #155e75 100%); color:#fff; padding:28px 20px; }
    .header h1 { font-size:1.8em; }
    .header .health { display:inline-block; margin-top:8px; padding:4px 12px; border-radius:999px; font-weight:600; font-size:.85em; background:${HEALTH_COLOR[model.status.health]}; }
    .header .sub { opacity:.85; font-size:.85em; margin-top:6px; }
    .container { max-width:1200px; margin:0 auto; padding:24px 16px; }
    h2 { font-size:1.15em; margin:28px 0 12px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }
    .stat-card { background:${card}; border:1px solid ${border}; border-radius:10px; padding:18px; }
    .stat-label { font-size:.8em; opacity:.7; text-transform:uppercase; letter-spacing:.05em; }
    .stat-value { font-size:2.2em; font-weight:700; margin-top:6px; }
    .stat-unit { font-size:.4em; opacity:.6; margin-left:6px; font-weight:600; }
    table { width:100%; border-collapse:collapse; background:${card}; border:1px solid ${border}; border-radius:10px; overflow:hidden; }
    th, td { padding:10px 14px; border-bottom:1px solid ${border}; text-align:left; font-size:.9em; }
    th { background:${darkMode ? '#333' : '#f3f4f6'}; font-weight:600; }
    td.mono { font-family:monospace; font-size:.82em; }
    td.empty, .empty { opacity:.6; text-align:center; padding:16px; }
    .badge { color:#fff; padding:2px 10px; border-radius:999px; font-size:.78em; font-weight:600; text-transform:capitalize; }
    .priority-high { background:#ef4444; } .priority-medium { background:#f59e0b; } .priority-low { background:#6b7280; }
    .action { cursor:pointer; border:1px solid ${border}; background:${darkMode ? '#333' : '#f9fafb'}; color:${fg}; padding:5px 12px; border-radius:6px; font-size:.82em; }
    .action:hover { border-color:#0f766e; color:#0f766e; }
    .alerts { background:${card}; border:1px solid ${border}; border-radius:10px; padding:8px 16px; }
    .alert-item { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid ${border}; }
    .alert-item:last-child { border-bottom:none; }
    .alert-title { flex:1; } .alert-age { opacity:.7; font-size:.85em; }
    .trend-controls { display:flex; gap:8px; margin-bottom:12px; }
    .trend-btn { cursor:pointer; border:1px solid ${border}; background:${card}; color:${fg}; padding:6px 16px; border-radius:6px; font-size:.85em; }
    .trend-btn.active { background:#0f766e; color:#fff; border-color:#0f766e; }
    .trend-panel { display:none; grid-template-columns:1fr 1fr; gap:16px; }
    .trend-panel.active { display:grid; }
    .trend-chart { background:${card}; border:1px solid ${border}; border-radius:10px; padding:14px; }
    .trend-heading { font-size:.82em; opacity:.75; margin-bottom:8px; }
    .spark { width:100%; height:auto; color:${fg}; }
    .rec-item { display:flex; gap:12px; align-items:flex-start; background:${card}; border:1px solid ${border}; border-radius:10px; padding:12px 14px; margin-bottom:8px; }
    .rec-title { font-weight:600; font-size:.9em; } .rec-detail { font-size:.82em; opacity:.75; }
    @media (max-width:768px) { .trend-panel.active { grid-template-columns:1fr; } .stat-value { font-size:1.7em; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="health">${escapeHtml(model.status.health)}</div>
    <div class="sub">Generated ${escapeHtml(model.generatedAt)}</div>
  </div>
  <div class="container">
    <h2>Live Status</h2>
    <div class="stats">${statusCards(model)}</div>

    <h2>Incidents</h2>
    <table>
      <thead><tr><th>Severity</th><th>Title</th><th>Timeline</th><th>Duration</th><th>Impact</th><th>Action</th></tr></thead>
      <tbody>${incidentRows(model.incidents)}</tbody>
    </table>

    <h2>Test Coverage Gaps</h2>
    <table>
      <thead><tr><th>Error Pattern</th><th>Occurrences</th><th>Coverage</th><th>Action</th></tr></thead>
      <tbody>${gapRows(model.gaps)}</tbody>
    </table>

    <h2>Active Alerts</h2>
    <div class="alerts">${alertItems(model.alerts)}</div>

    <h2>Trends</h2>
    ${trendPanels(model.trends)}

    <h2>Recommendations</h2>
    <div>${recommendationItems(model.recommendations)}</div>
  </div>

  <script>
    function selectTrend(range) {
      document.querySelectorAll('.trend-panel').forEach(function (panel) {
        panel.classList.toggle('active', panel.getAttribute('data-range') === range);
      });
      document.querySelectorAll('.trend-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-range') === range);
      });
    }
    function sentinelAction(action, target) {
      document.dispatchEvent(new CustomEvent('sentinel-action', { detail: { action: action, target: target } }));
    }
  </script>
</body>
</html>`;
}

/**
 * Renders and writes a Sentinel dashboard to disk.
 * @param model The aggregated dashboard view model.
 * @param filePath Destination HTML file path.
 * @param options Rendering options.
 * @returns The absolute path the dashboard was written to.
 * @throws Error when the file cannot be written.
 */
export async function writeSentinelDashboard(
  model: SentinelDashboardModel,
  filePath: string,
  options: SentinelDashboardRenderOptions = {}
): Promise<string> {
  const html = generateSentinelDashboardHtml(model, options);
  const resolved = path.resolve(filePath);
  try {
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, html, 'utf-8');
  } catch (error) {
    log.error('Failed to write Sentinel dashboard', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
  log.success('Wrote Sentinel dashboard', { path: resolved });
  return resolved;
}

/** Rounds a number to at most two decimal places for SVG coordinates. */
function round(value: number): number {
  return Number(value.toFixed(2));
}
