/** Deployment traceability report generation with embedded CI/CD evidence. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type GoldenThreadChain, STAGE_NAMES, type Stage } from '../core/golden-thread-store.js';
import { type CicdMetadata } from '../core/golden-thread-cicd.js';
import { log } from '../core/logger.js';

/** Options for generating a deployment report. */
export interface DeploymentReportOptions {
  /** Report title. Defaults to a deployment-specific title. */
  title?: string;
  /** Render in dark mode. Defaults to false. */
  darkMode?: boolean;
}

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

/** Renders the status badge color for a stage status. */
function statusColor(status: string | undefined): string {
  if (status === 'PASSED') return '#22c55e';
  if (status === 'FAILED') return '#ef4444';
  if (status === 'IN_PROGRESS') return '#f59e0b';
  return '#6b7280';
}

/** Safely parses a stage metadata JSON blob into a record. */
function parseMetadata(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Builds the CI/CD metadata summary table rows. */
function metadataRows(metadata: CicdMetadata): string {
  const coverage = metadata.test_coverage === null ? 'N/A' : `${metadata.test_coverage}%`;
  const entries: [string, string][] = [
    ['Repository', metadata.repo],
    ['Branch', metadata.branch],
    ['Commit', metadata.commit_sha],
    ['Deployment Env', metadata.deployment_env],
    ['Build Status', metadata.build_status],
    ['Test Coverage', coverage],
    ['Run ID', metadata.run_id],
    ['Triggered By', metadata.actor],
    ['Workflow', metadata.workflow],
    ['Event', metadata.event_name]
  ];
  return entries
    .map(
      ([key, value]) =>
        `<tr><td class="k">${escapeHtml(key)}</td><td class="v">${escapeHtml(value)}</td></tr>`
    )
    .join('');
}

/** Builds the per-stage evidence cards. */
function stageCards(chain: GoldenThreadChain): string {
  let html = '';
  for (let stageNumber = 1; stageNumber <= 7; stageNumber++) {
    const stage = chain.stages.find(s => s.stage === stageNumber);
    const name = STAGE_NAMES[stageNumber as Stage];
    const status = stage?.status ?? 'PENDING';
    const meta = parseMetadata(stage?.metadata);
    const metaJson = escapeHtml(JSON.stringify(meta, null, 2));
    const artifact = stage?.artifact_url
      ? `<p><strong>Evidence:</strong> <a href="${escapeHtml(stage.artifact_url)}" target="_blank" rel="noopener">${escapeHtml(stage.artifact_url)}</a></p>`
      : '';

    html += `
      <div class="stage">
        <div class="stage-head" style="background:${statusColor(stage?.status)};">
          <span class="num">${stageNumber}</span>
          <span class="name">${escapeHtml(name)}</span>
          <span class="status">${escapeHtml(status)}</span>
        </div>
        <div class="stage-body">
          <p><strong>Actor:</strong> ${escapeHtml(stage?.actor ?? 'N/A')}</p>
          <p><strong>Timestamp:</strong> ${stage?.timestamp ? escapeHtml(new Date(stage.timestamp).toISOString()) : 'N/A'}</p>
          ${artifact}
          <details><summary>Embedded evidence</summary><pre>${metaJson}</pre></details>
        </div>
      </div>`;
  }
  return html;
}

/**
 * Generates a self-contained HTML deployment traceability report with embedded
 * CI/CD metadata and per-stage evidence.
 * @param chain The Golden Thread chain for the deployment
 * @param metadata CI/CD metadata captured for the run
 * @param opts Report rendering options
 * @returns HTML document string
 */
export function generateDeploymentReport(
  chain: GoldenThreadChain,
  metadata: CicdMetadata,
  opts: DeploymentReportOptions = {}
): string {
  const { darkMode = false } = opts;
  const title = opts.title ?? `Deployment Traceability — ${metadata.repo}@${metadata.commit_sha.slice(0, 7)}`;
  const bg = darkMode ? '#1e1e1e' : '#f9fafb';
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:${bg}; color:${fg}; padding:32px 16px; line-height:1.6; }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 1.6em; margin-bottom: 8px; }
    .sub { opacity: .7; font-family: monospace; margin-bottom: 24px; }
    table { width:100%; border-collapse: collapse; background:${card}; border:1px solid ${border}; border-radius:8px; overflow:hidden; margin-bottom:28px; }
    td { padding:10px 14px; border-bottom:1px solid ${border}; font-size:.92em; }
    td.k { font-weight:600; width:200px; }
    td.v { font-family: monospace; word-break: break-all; }
    .stage { background:${card}; border:1px solid ${border}; border-radius:8px; overflow:hidden; margin-bottom:14px; }
    .stage-head { display:flex; align-items:center; gap:12px; padding:12px 16px; color:#fff; font-weight:600; }
    .stage-head .num { font-size:1.2em; }
    .stage-head .status { margin-left:auto; font-size:.85em; }
    .stage-body { padding:14px 16px; }
    .stage-body p { margin:6px 0; font-size:.9em; }
    .stage-body a { color:#3b82f6; text-decoration:none; }
    pre { background:${darkMode ? '#1a1a1a' : '#f3f4f6'}; padding:10px; border-radius:6px; overflow-x:auto; font-size:.82em; margin-top:8px; }
    summary { cursor:pointer; font-size:.85em; opacity:.8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">Thread ID: ${escapeHtml(chain.golden_thread_id)} · Generated: ${escapeHtml(new Date().toISOString())}</p>
    <h2>CI/CD Metadata</h2>
    <table>${metadataRows(metadata)}</table>
    <h2>7-Stage Traceability</h2>
    ${stageCards(chain)}
  </div>
</body>
</html>`;
}

/**
 * Generates and writes a deployment report to disk.
 * @param chain The Golden Thread chain for the deployment
 * @param metadata CI/CD metadata captured for the run
 * @param filePath Destination HTML file path
 * @param opts Report rendering options
 * @returns The absolute path the report was written to
 * @throws Error if the file cannot be written
 */
export async function writeDeploymentReport(
  chain: GoldenThreadChain,
  metadata: CicdMetadata,
  filePath: string,
  opts: DeploymentReportOptions = {}
): Promise<string> {
  const html = generateDeploymentReport(chain, metadata, opts);
  const resolved = path.resolve(filePath);
  try {
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, html, 'utf-8');
  } catch (error) {
    log.error('Failed to write deployment report', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
  log.success('Wrote deployment traceability report', { path: resolved });
  return resolved;
}
