/** Reporter for Golden Thread commit-based traceability reports. */
import type { GoldenThreadChain } from '../core/golden-thread-store.js';

/** Renders a commit trace as HTML. */
export function renderCommitTraceHtml(chain: GoldenThreadChain, commit_sha: string): string {
  const stageNames = ['', 'Spec', 'Test', 'Evidence', 'Build', 'Deploy', 'Monitor', 'Debug'];
  const statusBadges: Record<string, string> = {
    'PASSED': '<span style="background-color: #22c55e; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">PASSED</span>',
    'FAILED': '<span style="background-color: #ef4444; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">FAILED</span>',
    'IN_PROGRESS': '<span style="background-color: #f59e0b; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">IN_PROGRESS</span>',
    'PENDING': '<span style="background-color: #6b7280; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">PENDING</span>'
  };

  const deploymentStatusBadges: Record<string, string> = {
    'GREEN': '<span style="background-color: #22c55e; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">DEPLOYED</span>',
    'YELLOW': '<span style="background-color: #f59e0b; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">PENDING</span>',
    'RED': '<span style="background-color: #ef4444; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">FAILED</span>'
  };

  const stagesHtml = chain.stages
    .map(stage => {
      const name = stageNames[stage.stage] || `Stage ${stage.stage}`;
      const statusBadge = statusBadges[stage.status] || stage.status;
      const deploymentBadge = stage.deployment_status ? deploymentStatusBadges[stage.deployment_status] || '' : '';

      let detailsHtml = '';
      if (stage.deployment_metadata) {
        const deployMeta = JSON.parse(stage.deployment_metadata);
        detailsHtml = `
          <div style="margin-top: 8px; padding: 8px; background-color: #f3f4f6; border-radius: 4px; font-size: 12px;">
            <p><strong>Environment:</strong> ${deployMeta.environment || 'N/A'}</p>
            <p><strong>Deployed By:</strong> ${deployMeta.deployed_by || 'N/A'}</p>
            <p><strong>Timestamp:</strong> ${deployMeta.timestamp || stage.timestamp}</p>
            ${deployMeta.workflow_run_id ? `<p><strong>Workflow Run:</strong> ${deployMeta.workflow_run_id}</p>` : ''}
          </div>
        `;
      }

      return `
        <div style="padding: 12px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3 style="margin: 0; font-size: 16px;">Stage ${stage.stage}: ${name}</h3>
            <div>
              ${statusBadge}
              ${deploymentBadge}
            </div>
          </div>
          <p style="margin: 8px 0; font-size: 12px; color: #6b7280;">
            <strong>Timestamp:</strong> ${new Date(stage.timestamp).toLocaleString()}
          </p>
          <p style="margin: 8px 0; font-size: 12px; color: #6b7280;">
            <strong>Actor:</strong> ${stage.actor}
          </p>
          <p style="margin: 8px 0;">
            <strong>Artifact:</strong> <a href="${stage.artifact_url}" style="color: #3b82f6; text-decoration: none;">${stage.artifact_url}</a>
          </p>
          ${detailsHtml}
        </div>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Golden Thread — Commit Trace</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background-color: #f9fafb;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      padding: 24px;
    }
    h1 {
      margin-top: 0;
      color: #111827;
      font-size: 24px;
    }
    .commit-info {
      background-color: #f3f4f6;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 24px;
      font-family: monospace;
      font-size: 12px;
    }
    .stages {
      margin-top: 24px;
    }
    .stage-timeline {
      position: relative;
      padding-left: 30px;
    }
    .stage-timeline::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 2px;
      background-color: #d1d5db;
    }
    .stage-timeline::after {
      content: '';
      position: absolute;
      left: -8px;
      top: 8px;
      width: 18px;
      height: 18px;
      background-color: white;
      border: 2px solid #d1d5db;
      border-radius: 50%;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Golden Thread — Commit Trace</h1>
    <div class="commit-info">
      <strong>Commit SHA:</strong> ${commit_sha}
      <br>
      <strong>Chain ID:</strong> ${chain.golden_thread_id}
      <br>
      <strong>Created:</strong> ${new Date(chain.created_at).toLocaleString()}
    </div>
    <div class="stages">
      <h2>7-Stage Traceability Chain</h2>
      ${stagesHtml}
    </div>
  </div>
</body>
</html>`;
}

/** Renders a commit trace as JSON. */
export function renderCommitTraceJson(chain: GoldenThreadChain, commit_sha: string): string {
  return JSON.stringify({
    commit_sha,
    chain_id: chain.golden_thread_id,
    created_at: chain.created_at,
    stages: chain.stages.map(stage => ({
      stage: stage.stage,
      status: stage.status,
      deployment_status: stage.deployment_status,
      timestamp: stage.timestamp,
      actor: stage.actor,
      artifact_url: stage.artifact_url,
      metadata: JSON.parse(stage.metadata || '{}'),
      deployment_metadata: stage.deployment_metadata ? JSON.parse(stage.deployment_metadata) : null
    }))
  }, null, 2);
}
