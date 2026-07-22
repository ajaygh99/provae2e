/**
 * LENS must review a PR in exactly one place. Previously, scripts/nightly-run.ps1
 * ran its own independent local LENS review pass (invoking `claude -p` directly
 * with a "You are LENS" prompt) in addition to the GitHub Actions workflow
 * (.github/workflows/agent-trigger.yml) that fires automatically on every PR's
 * opened/synchronize event - two overlapping, non-deterministic review paths
 * that could disagree on whether a PR is ready-for-qa.
 *
 * There's no PowerShell test runner in this repo, so this is a static check
 * over the script's source text - the same style already used for the YAML
 * pipeline checks in ci-pipeline.test.ts / smoke-gate.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('LENS review — single mechanism', () => {
  const nightlyScript = readFileSync(path.join(__dirname, '../../scripts/nightly-run.ps1'), 'utf-8');
  const agentTriggerWorkflow = readFileSync(
    path.join(__dirname, '../../.github/workflows/agent-trigger.yml'),
    'utf-8'
  );

  it('nightly-run.ps1 does not instantiate its own separate LENS review persona', () => {
    expect(nightlyScript).not.toMatch(/You are LENS/);
  });

  it('nightly-run.ps1 does not define its own review-checklist prompt (the tell-tale of a duplicate LENS pass)', () => {
    // The model used for FORGE's implement/fix-up passes is a cost/quality choice
    // orthogonal to this check (and has changed over time) - what matters is that
    // no prompt here re-instantiates the reviewer persona/checklist itself.
    expect(nightlyScript).not.toMatch(/review checklist/i);
    expect(nightlyScript).not.toMatch(/BLOCKER \/ MAJOR \/ MINOR \/ SUGGESTION/);
  });

  it('nightly-run.ps1 instead waits for and observes the single GitHub Actions LENS review', () => {
    expect(nightlyScript).toMatch(/Wait-ForLensReview/);
    expect(nightlyScript).toMatch(/gh run list/);
    expect(nightlyScript).toMatch(/headRefOid/);
    expect(nightlyScript).toMatch(/\.headSha -eq \$headSha/);
    expect(nightlyScript).toContain('agent-trigger.yml');
  });

  it('requires all GitHub checks to pass before the script requests a merge', () => {
    expect(nightlyScript).toMatch(/Wait-ForQualityChecks/);
    expect(nightlyScript).toMatch(/gh pr checks .*--watch --fail-fast/);
    expect(nightlyScript.indexOf('Wait-ForQualityChecks')).toBeLessThan(
      nightlyScript.lastIndexOf('gh pr merge')
    );
  });

  it('the "You are LENS" review persona is defined in exactly one place repo-wide: the GitHub Actions workflow', () => {
    expect(agentTriggerWorkflow).toMatch(/You are LENS/);
    expect(nightlyScript).not.toMatch(/You are LENS/);
  });

  it('does not embed YAML comments inside multiline Claude CLI arguments', () => {
    const args = agentTriggerWorkflow.match(/claude_args:\s*\|([\s\S]*?)\n\s*prompt:/)?.[1] ?? '';
    expect(args).not.toMatch(/\s#/);
  });
});
