/**
 * Post-deploy smoke gate — regression checks for the bug where the CI
 * smoke job (`npm test -- --testPathPatterns=smoke`) silently reported
 * success even when zero smoke tests matched/ran, because the underlying
 * `test` script always passes --passWithNoTests.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import yaml from 'js-yaml';

describe('test:smoke script', () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as {
    scripts?: Record<string, string>;
  };

  it('exists and does not pass --passWithNoTests (so zero matches fails the build)', () => {
    const script = pkg.scripts?.['test:smoke'];
    expect(script).toBeDefined();
    expect(script).not.toMatch(/--passWithNoTests/);
  });
});

describe('prova-ci.yml — Post-deploy Smoke job', () => {
  interface WorkflowStep {
    run?: string;
  }
  interface Workflow {
    jobs: Record<string, { steps: WorkflowStep[] }>;
  }

  const doc = yaml.load(
    readFileSync(path.join(__dirname, '../../.github/workflows/prova-ci.yml'), 'utf-8')
  ) as Workflow;

  it('runs test:smoke rather than the passWithNoTests-inheriting `test` script', () => {
    const smokeJob = doc.jobs['smoke'];
    expect(smokeJob).toBeDefined();

    const runSteps = smokeJob.steps.map((step) => step.run).filter((run): run is string => Boolean(run));
    expect(runSteps.some((run) => run.includes('test:smoke'))).toBe(true);
    expect(runSteps.some((run) => /npm test -- --testPathPatterns=smoke\b/.test(run))).toBe(false);
  });
});

describe('tests/smoke directory', () => {
  it('contains at least one real smoke test file', () => {
    const smokeDir = path.join(__dirname, '../smoke');
    const files = readdirSync(smokeDir).filter((f) => f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
  });
});

describe('jest without --passWithNoTests (the mechanism test:smoke relies on)', () => {
  it('exits non-zero when a pattern matches zero test files', () => {
    const jestBin = path.join(path.dirname(require.resolve('jest/package.json')), 'bin/jest.js');
    const result = spawnSync(
      process.execPath,
      [jestBin, '--testPathPatterns=this-pattern-matches-absolutely-nothing', '--forceExit'],
      { cwd: path.join(__dirname, '../..'), encoding: 'utf-8' }
    );

    expect(result.status).not.toBe(0);
  });
});
