import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

describe('ZAP security workflow', () => {
  it('is manually guarded, least privilege, bounded, policy-enforced, and artifact preserving', async () => {
    const workflowPath = path.resolve('.github/workflows/zap-security.yml');
    const source = await readFile(workflowPath, 'utf8');
    const workflow = parse(source) as {
      on: Record<string, unknown>;
      permissions: Record<string, string>;
      jobs: Record<string, {
        environment: string;
        'timeout-minutes': number;
        steps: Array<Record<string, unknown>>;
      }>;
    };
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const job = workflow.jobs['security-scan'];
    expect(job).toMatchObject({ environment: 'security-scanning', 'timeout-minutes': 30 });
    const serializedSteps = JSON.stringify(job?.steps);
    expect(serializedSteps).toContain('ghcr.io/zaproxy/zaproxy:stable');
    expect(serializedSteps).toContain('timeout --signal=TERM 20m');
    expect(serializedSteps).toContain('--minimum-risk HIGH');
    expect(serializedSteps).toContain('--maximum-critical');
    expect(serializedSteps).toContain('--all-findings');
    expect(serializedSteps).toContain('actions/upload-artifact@v4');
    expect(serializedSteps).toContain('"if":"always()"');
    expect(source).not.toContain('secrets.');
    expect(source).not.toContain('pull_request:');
    expect(source).not.toContain('push:');
  });
});
