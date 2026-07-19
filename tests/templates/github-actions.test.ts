/**
 * GitHub Actions drop-in template tests
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

interface WorkflowStep {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  if?: string;
}

interface WorkflowJob {
  'runs-on': string;
  steps: WorkflowStep[];
}

interface Workflow {
  name?: string;
  on?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
}

describe('GitHub Actions drop-in template', () => {
  const templatePath = path.join(__dirname, '../../templates/github-actions/qe-tool-ci.yml');
  const raw = readFileSync(templatePath, 'utf-8');

  it('is valid YAML', () => {
    expect(() => yaml.load(raw)).not.toThrow();
  });

  it('has a top-level `on` trigger with a configurable url input', () => {
    const doc = yaml.load(raw) as Workflow;

    expect(doc.on).toBeDefined();
    const dispatch = (doc.on as Record<string, unknown>).workflow_dispatch as
      | { inputs?: Record<string, { required?: boolean; default?: string }> }
      | undefined;

    expect(dispatch).toBeDefined();
    expect(dispatch?.inputs?.url).toBeDefined();
    expect(dispatch?.inputs?.url?.required).toBe(true);
  });

  it('has a top-level `jobs` key with at least one job', () => {
    const doc = yaml.load(raw) as Workflow;

    expect(doc.jobs).toBeDefined();
    const jobNames = Object.keys(doc.jobs ?? {});
    expect(jobNames.length).toBeGreaterThan(0);
  });

  it('installs @provae2e/cli globally', () => {
    const doc = yaml.load(raw) as Workflow;
    const steps = Object.values(doc.jobs ?? {}).flatMap((job) => job.steps);

    const installStep = steps.find((step) => step.run?.includes('npm install -g @provae2e/cli'));
    expect(installStep).toBeDefined();
  });

  it('runs qe-tool against the configurable url with --type all and --report', () => {
    const doc = yaml.load(raw) as Workflow;
    const steps = Object.values(doc.jobs ?? {}).flatMap((job) => job.steps);

    const runStep = steps.find((step) => step.run?.includes('qe-tool run'));
    expect(runStep).toBeDefined();
    expect(runStep?.run).toContain('${{ inputs.url }}');
    expect(runStep?.run).toContain('--type all');
    expect(runStep?.run).toContain('--report');
  });

  it('uploads the Allure report as a build artifact', () => {
    const doc = yaml.load(raw) as Workflow;
    const steps = Object.values(doc.jobs ?? {}).flatMap((job) => job.steps);

    const uploadStep = steps.find((step) => step.uses?.includes('actions/upload-artifact'));
    expect(uploadStep).toBeDefined();
    expect(uploadStep?.with?.path).toBe('allure-report/');
  });
});
