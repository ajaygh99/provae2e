import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

describe('analytics dashboard CI', () => {
  it('is least privilege, bounded, comprehensive, and artifact preserving', async () => {
    const source = await readFile(path.resolve('.github/workflows/analytics-integration.yml'), 'utf8');
    const workflow = parse(source) as {
      permissions: Record<string, string>;
      concurrency: Record<string, unknown>;
      jobs: Record<string, { 'timeout-minutes': number; steps: Array<Record<string, unknown>> }>;
    };
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toBeDefined();
    expect(Object.keys(workflow.jobs)).toEqual(['dashboard', 'postgres']);
    expect(workflow.jobs.dashboard?.['timeout-minutes']).toBe(15);
    expect(workflow.jobs.postgres?.['timeout-minutes']).toBe(15);
    const steps = JSON.stringify(workflow.jobs.dashboard?.steps);
    expect(steps).toContain('npm test -- --runInBand --testPathPatterns=analytics');
    expect(steps).toContain('verify-analytics-dashboard.js');
    expect(steps).toContain('actions/upload-artifact@v4');
    expect(steps).toContain('"if":"always()"');
    expect(source).not.toContain('secrets.');
  });

  it('verifies built CLI HTML and JSON without external dashboard dependencies', async () => {
    const source = await readFile(path.resolve('scripts/verify-analytics-dashboard.js'), 'utf8');
    expect(source).toContain("require('../dist/storage/sqlite-analytics-store.js')");
    expect(source).toContain("'dist/cli/run.js'");
    expect(source).toContain("parsed.summary.totalTests !== 3");
    expect(source).toContain('/<script\\b|<link\\b|https?:\\/\\//i');
    expect(source).toContain("DATABASE_URL: ''");
  });
});
