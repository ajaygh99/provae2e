/**
 * Export Golden Thread chains to PDF using Playwright.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { GoldenThreadChain, STAGE_NAMES, type StageLog } from '../core/golden-thread-store.js';

/**
 * Convert Golden Thread chain to PDF report.
 */
export async function exportChainToPDF(chain: GoldenThreadChain, outputPath: string): Promise<void> {
  // Create output directory if needed
  const dir = path.dirname(outputPath);
  await mkdir(dir, { recursive: true });

  // Generate HTML report
  const html = generateHTMLReport(chain);

  // Launch browser and generate PDF
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({ path: outputPath, format: 'A4', margin: { top: 20, right: 20, bottom: 20, left: 20 } });
  } finally {
    await browser.close();
  }
}

/**
 * Generate HTML report from chain.
 * @param chain The Golden Thread chain to report
 * @returns HTML string
 */
function generateHTMLReport(chain: GoldenThreadChain): string {
  const styles = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; }
      .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
      .header h1 { margin: 0; font-size: 28px; color: #000; }
      .header p { margin: 5px 0; color: #666; }
      .metadata { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; background: #f5f5f5; padding: 15px; border-radius: 4px; }
      .metadata-item { }
      .metadata-item .label { font-weight: 600; color: #333; font-size: 12px; text-transform: uppercase; }
      .metadata-item .value { color: #666; margin-top: 4px; word-break: break-all; font-size: 12px; font-family: monospace; }
      .stages { margin-top: 30px; }
      .stage { margin-bottom: 20px; padding: 15px; border-left: 4px solid #0066cc; background: #fafafa; }
      .stage.PASSED { border-left-color: #28a745; }
      .stage.FAILED { border-left-color: #dc3545; }
      .stage.IN_PROGRESS { border-left-color: #ffc107; }
      .stage.PENDING { border-left-color: #6c757d; }
      .stage-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
      .stage-number { font-size: 20px; font-weight: 700; color: #0066cc; }
      .stage-name { font-size: 18px; font-weight: 600; margin: 0 10px; color: #000; }
      .stage-status { padding: 4px 8px; border-radius: 3px; font-size: 12px; font-weight: 600; }
      .stage-status.PASSED { background: #28a745; color: white; }
      .stage-status.FAILED { background: #dc3545; color: white; }
      .stage-status.IN_PROGRESS { background: #ffc107; color: #000; }
      .stage-status.PENDING { background: #6c757d; color: white; }
      .stage-details { margin-top: 8px; font-size: 12px; color: #666; }
      .stage-details p { margin: 4px 0; }
      .stage-details .label { font-weight: 600; color: #333; }
      .deployment { margin-top: 8px; padding: 8px; border-radius: 3px; font-size: 11px; }
      .deployment.GREEN { background: #d4edda; color: #155724; }
      .deployment.YELLOW { background: #fff3cd; color: #856404; }
      .deployment.RED { background: #f8d7da; color: #721c24; }
      .metadata-details { margin-top: 8px; font-size: 11px; background: white; padding: 8px; border-radius: 3px; }
      .footer { margin-top: 40px; border-top: 1px solid #ddd; padding-top: 20px; text-align: center; color: #999; font-size: 10px; }
    </style>
  `;

  const header = `
    <div class="header">
      <h1>🔗 Golden Thread Report</h1>
      <p><strong>Chain ID:</strong> ${chain.golden_thread_id}</p>
      <p><strong>Created:</strong> ${new Date(chain.created_at).toLocaleString()}</p>
    </div>
  `;

  const metadata = `
    <div class="metadata">
      <div class="metadata-item">
        <div class="label">Chain ID</div>
        <div class="value">${chain.golden_thread_id}</div>
      </div>
      <div class="metadata-item">
        <div class="label">Created At</div>
        <div class="value">${chain.created_at}</div>
      </div>
      <div class="metadata-item">
        <div class="label">Total Stages</div>
        <div class="value">${chain.stages.length}</div>
      </div>
      <div class="metadata-item">
        <div class="label">Duration</div>
        <div class="value">${formatDuration(chain.stages)}</div>
      </div>
    </div>
  `;

  const stagesHtml = chain.stages
    .map(stage => {
      const metadata = ((): Record<string, unknown> => {
        try {
          return JSON.parse(stage.metadata);
        } catch {
          return { raw: stage.metadata };
        }
      })();

      return `
        <div class="stage ${stage.status}">
          <div class="stage-header">
            <div>
              <span class="stage-number">${stage.stage}</span>
              <span class="stage-name">${STAGE_NAMES[stage.stage]}</span>
            </div>
            <span class="stage-status ${stage.status}">${stage.status}</span>
          </div>
          <div class="stage-details">
            <p><label class="label">Time:</label> ${new Date(stage.timestamp).toLocaleString()}</p>
            <p><label class="label">Actor:</label> ${stage.actor}</p>
            <p><label class="label">Artifact:</label> ${stage.artifact_url}</p>
            ${stage.deployment_status ? `<div class="deployment ${stage.deployment_status}">🚀 Deployment: ${stage.deployment_status}</div>` : ''}
            ${Object.keys(metadata).length > 0 ? `
              <div class="metadata-details">
                <strong>Metadata:</strong><br/>
                ${Object.entries(metadata)
                  .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                  .join('<br/>')}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  const footer = `
    <div class="footer">
      Generated by PROVA Golden Thread | ${new Date().toLocaleString()}
    </div>
  `;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Golden Thread Report - ${chain.golden_thread_id}</title>
      ${styles}
    </head>
    <body>
      ${header}
      ${metadata}
      <div class="stages">${stagesHtml}</div>
      ${footer}
    </body>
    </html>
  `;
}

/**
 * Format duration between first and last stage.
 */
function formatDuration(stages: StageLog[]): string {
  if (stages.length < 2) return '—';
  const first = new Date(stages[0].timestamp).getTime();
  const last = new Date(stages[stages.length - 1].timestamp).getTime();
  const ms = last - first;

  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
