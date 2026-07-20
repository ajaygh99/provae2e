/**
 * PROVA CI pipeline config — regression checks for two related defects:
 * (1) the test job used to filter to a hardcoded subset of test directories
 *     (browser/api/mobile) via --testPathPattern, silently skipping every
 *     other tests/ subdirectory (core, reporters, cli, scripts, templates...);
 * (2) coverage was collected for display only - nothing enforced a real
 *     80% floor that fails the build when unmet.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

interface WorkflowStep {
  uses?: string;
  run?: string;
  name?: string;
}

interface WorkflowJob {
  'runs-on': string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
}

interface Workflow {
  jobs: Record<string, WorkflowJob>;
}

describe('prova-ci.yml — full test-directory coverage', () => {
  const workflowPath = path.join(__dirname, '../../.github/workflows/prova-ci.yml');
  const doc = yaml.load(readFileSync(workflowPath, 'utf-8')) as Workflow;

  it('has a test job that runs the full suite, not a --testPathPattern-filtered subset', () => {
    const testJob = doc.jobs['test'];
    expect(testJob).toBeDefined();

    const runSteps = (testJob.steps ?? []).map((step) => step.run).filter((run): run is string => Boolean(run));
    const testRun = runSteps.find((run) => run.includes('test'));

    expect(testRun).toBeDefined();
    // Any --testPathPattern filter here would silently exclude whichever tests/
    // subdirectories aren't named - which is exactly the bug being fixed.
    expect(testRun).not.toMatch(/--testPathPattern/);
  });

  it('runs a coverage-collecting script (test:ci) rather than a bare, unfiltered jest invocation', () => {
    const testJob = doc.jobs['test'];
    const runSteps = (testJob.steps ?? []).map((step) => step.run).filter((run): run is string => Boolean(run));

    expect(runSteps.some((run) => run.includes('test:ci'))).toBe(true);
  });
});

describe('package.json jest config — real 80% coverage gate', () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as {
    jest?: { coverageThreshold?: { global?: Record<string, number> } };
    scripts?: Record<string, string>;
  };

  it('defines a global coverageThreshold of at least 80% for every metric', () => {
    const global = pkg.jest?.coverageThreshold?.global;
    expect(global).toBeDefined();

    for (const metric of ['branches', 'functions', 'lines', 'statements']) {
      expect(global?.[metric]).toBeGreaterThanOrEqual(80);
    }
  });

  it('test:ci actually collects coverage, so the threshold is enforced in CI', () => {
    expect(pkg.scripts?.['test:ci']).toMatch(/--coverage/);
  });
});

describe('prova-ci.yml - safe SHIP workflow', () => {
  const workflowPath = path.join(__dirname, '../../.github/workflows/prova-ci.yml');
  const doc = yaml.load(readFileSync(workflowPath, 'utf-8')) as Workflow;
  const ship = doc.jobs['ship'];

  it('grants the release job permission to push its version commit and tag', () => {
    expect(ship.permissions?.['contents']).toBe('write');
  });

  it('fails clearly when npm authentication is missing or invalid', () => {
    const authStep = ship.steps.find((step) => step.name === 'Verify npm authentication');
    expect(authStep?.run).toContain('NPM_TOKEN is not configured');
    expect(authStep?.run).toContain('npm whoami');
  });

  it('installs Chromium before npm publish triggers prepublishOnly tests', () => {
    const installIndex = ship.steps.findIndex((step) => step.run?.includes('playwright install'));
    const publishIndex = ship.steps.findIndex((step) => step.run?.includes('npm publish'));
    expect(installIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(installIndex);
  });

  it('publishes before creating and pushing release metadata', () => {
    const releaseStep = ship.steps.find((step) => step.run?.includes('npm publish'))?.run ?? '';
    expect(releaseStep.indexOf('npm publish')).toBeLessThan(releaseStep.indexOf('git commit'));
    expect(releaseStep.indexOf('npm publish')).toBeLessThan(releaseStep.indexOf('git tag'));
    expect(releaseStep.indexOf('npm publish')).toBeLessThan(releaseStep.indexOf('git push'));
  });
});
