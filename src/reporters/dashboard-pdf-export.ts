/** PDF export for Golden Thread dashboard and traceability reports. */
import type { GoldenThreadChain } from '../core/golden-thread-store.js';
import { STAGE_NAMES } from '../core/golden-thread-store.js';

interface PdfExportOptions {
  title?: string;
  includeMetadata?: boolean;
}

/**
 * Generates a PDF report for a Golden Thread chain using HTML.
 * Note: Actual PDF rendering requires Playwright browser instance in runtime.
 * This function generates the HTML content suitable for PDF conversion.
 * @param chain The complete chain
 * @param opts Export options
 * @returns HTML string formatted for PDF
 */
export function generatePdfReportHtml(chain: GoldenThreadChain, opts: PdfExportOptions = {}): string {
  const { title = 'Golden Thread Traceability Report', includeMetadata = true } = opts;

  let stagesHtml = '';
  for (let i = 1; i <= 7; i++) {
    const stage = chain.stages.find(s => s.stage === i);
    const stageName = STAGE_NAMES[i as keyof typeof STAGE_NAMES];
    const statusColor = stage?.status === 'FAILED' ? '#f44336' : stage?.status === 'PASSED' ? '#4caf50' : '#ffb74d';
    const statusText = stage?.status || 'PENDING';

    let metadataHtml = '';
    if (includeMetadata && stage?.metadata) {
      try {
        const meta = JSON.parse(stage.metadata);
        metadataHtml = `<div style="margin-top: 10px; font-size: 12px;"><strong>Metadata:</strong><pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto;">${escapeHtmlForPdf(JSON.stringify(meta, null, 2))}</pre></div>`;
      } catch {
        // ignore parse errors
      }
    }

    stagesHtml += `
      <div style="margin-bottom: 30px; page-break-inside: avoid;">
        <div style="background-color: ${statusColor}; color: white; padding: 15px; border-radius: 4px; margin-bottom: 10px;">
          <h3 style="margin: 0; font-size: 18px;">Stage ${i}: ${stageName}</h3>
        </div>
        <div style="padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
          <p><strong>Status:</strong> ${statusText}</p>
          <p><strong>Actor:</strong> ${escapeHtmlForPdf(stage?.actor || 'N/A')}</p>
          <p><strong>Timestamp:</strong> ${stage?.timestamp ? new Date(stage.timestamp).toLocaleString() : 'N/A'}</p>
          ${stage?.artifact_url ? `<p><strong>Artifact URL:</strong> <a href="${escapeHtmlForPdf(stage.artifact_url)}" style="color: #2196f3; text-decoration: none; word-break: break-all;">${escapeHtmlForPdf(stage.artifact_url)}</a></p>` : ''}
          ${metadataHtml}
        </div>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlForPdf(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      background: white;
      padding: 20px;
    }
    .cover-page {
      page-break-after: always;
      text-align: center;
      padding: 100px 20px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .cover-page h1 {
      font-size: 48px;
      margin-bottom: 20px;
      color: #667eea;
    }
    .cover-page p {
      font-size: 18px;
      margin-bottom: 10px;
      color: #666;
    }
    .report-meta {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: #f5f5f5;
      border-radius: 4px;
    }
    .report-meta p {
      margin: 8px 0;
      font-size: 14px;
      color: #666;
    }
    h2 {
      font-size: 24px;
      margin-top: 30px;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #667eea;
      page-break-after: avoid;
    }
    @media print {
      body { padding: 0; }
      .cover-page { padding: 0; }
      a { color: #0066cc; }
    }
  </style>
</head>
<body>
  <div class="cover-page">
    <h1>${escapeHtmlForPdf(title)}</h1>
    <p>Golden Thread Traceability Report</p>
  </div>

  <div class="report-meta">
    <p><strong>Chain ID:</strong> ${escapeHtmlForPdf(chain.golden_thread_id)}</p>
    <p><strong>Created:</strong> ${new Date(chain.created_at).toLocaleString()}</p>
    <p><strong>Report Generated:</strong> ${new Date().toLocaleString()}</p>
  </div>

  <h2>Executive Summary</h2>
  <p>This report documents the complete traceability chain for the test/deployment identified by ID ${escapeHtmlForPdf(chain.golden_thread_id)}. All 7 stages are tracked and evidenced below.</p>

  <h2>Full Chain Details</h2>
  ${stagesHtml}

  <h2>Verification</h2>
  <p>This document serves as official evidence of the Golden Thread traceability for compliance, audit, and troubleshooting purposes. All artifacts are linked and timestamped.</p>
</body>
</html>`;
}

/**
 * Escapes HTML special characters for safe PDF rendering.
 */
function escapeHtmlForPdf(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}
