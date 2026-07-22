import { execFileSync } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');
const seederPath = join(repoRoot, 'scripts', 'create-phase3-enterprise-issues.ps1');
const nightlyPath = join(repoRoot, 'scripts', 'nightly-run.ps1');
const script = readFileSync(seederPath, 'utf8');
const nightly = readFileSync(nightlyPath, 'utf8');
const windowsIt = process.platform === 'win32' ? it : it.skip;

type IssueDefinition = { num: number; title: string; category: string };

function definitions(): IssueDefinition[] {
  const pattern = /num\s*=\s*(\d+)\s*\r?\n\s*title\s*=\s*"([^"]+)"\s*\r?\n\s*category\s*=\s*"([^"]+)"/g;
  return [...script.matchAll(pattern)].map((match) => ({
    num: Number(match[1]),
    title: match[2],
    category: match[3],
  }));
}

describe('Phase 3 enterprise issue definitions', () => {
  const issues = definitions();

  it('defines exactly 80 uniquely numbered and titled issues', () => {
    expect(issues).toHaveLength(80);
    expect(new Set(issues.map(({ num }) => num)).size).toBe(80);
    expect(new Set(issues.map(({ title }) => title)).size).toBe(80);
    expect(issues.map(({ num }) => num)).toEqual(Array.from({ length: 80 }, (_, index) => index + 41));
  });

  it.each([
    ['Golden Thread', 20],
    ['Sentinel', 20],
    ['Appium', 12],
    ['OWASP ZAP', 8],
    ['Knowledge Graph', 20],
  ])('defines the required %s issue count', (category, count) => {
    expect(issues.filter((issue) => issue.category === category)).toHaveLength(count);
  });

  it('gives every issue acceptance criteria and story points', () => {
    expect(script.match(/## Acceptance Criteria/g)).toHaveLength(80);
    expect(script.match(/storyPoints\s*=\s*(?:2|3|5|8)/g)).toHaveLength(80);
  });
});

describe('Phase 3 enterprise seeder safety', () => {
  it('uses exact-title idempotency and fails GitHub operations fast', () => {
    expect(script).toMatch(/\$existingTitles -contains \$issue\.title/);
    expect(script).toMatch(/return \(\$failed -eq 0 -and \(\$created \+ \$skipped\) -eq \$AllIssues\.Count\)/);
    expect(script).toMatch(/Verify-GitHubAuth/);
    expect(script).toMatch(/Check-RateLimit/);
  });

  it('streams issue bodies through stdin so Windows preserves quotes and newlines', () => {
    expect(script).toMatch(/\$Body \| & gh issue create .*--body-file -/);
    expect(script).not.toMatch(/"--body", \$Body/);
  });

  it('applies common and feature-specific epic labels', () => {
    for (const label of [
      'phase3', 'feature', 'epic:enterprise', 'epic:golden-thread',
      'epic:sentinel', 'epic:appium', 'epic:zap', 'epic:knowledge-graph',
    ]) {
      expect(script).toContain(`'${label}'`);
    }
  });

  it('queues only Golden Thread definitions 41 through 45', () => {
    expect(script).toMatch(/\$issue\.num -le 45 -and \$issue\.category -eq "Golden Thread"/);
    expect(script).not.toMatch(/\$labels \+= "agent-implement"[\s\S]{0,80}\b(?:Sentinel|Appium|OWASP ZAP|Knowledge Graph)\b/);
  });

  windowsIt('executes a mutation-free 80-issue dry run', () => {
    const report = join(repoRoot, 'daily', '.phase3-seeder-dry-run-test.md');
    if (existsSync(report)) rmSync(report);
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', seederPath,
      '-DryRun', '-NightFilter', 'both', '-ReportPath', report,
    ], { encoding: 'utf8' });
    expect(output).toContain('Total: 80 issues ready for creation');
    expect(output.match(/^\[#\d+\]/gm)).toHaveLength(80);
    expect(existsSync(report)).toBe(false);
  });
});

describe('nightly Phase 3 integration', () => {
  it('repairs partial seeds using authoritative counts', () => {
    expect(nightly).toMatch(/--label "epic:studio" --limit 100/);
    expect(nightly).toMatch(/\$phase3StudioCount -lt 40/);
    expect(nightly).toMatch(/--label "epic:enterprise" --limit 100/);
    expect(nightly).toMatch(/\$phase3EnterpriseCount -lt 80/);
    expect(nightly).toMatch(/\$phase3StudioParsed\.Count/);
    expect(nightly).toMatch(/\$phase3EnterpriseParsed\.Count/);
  });

  it('exits after a seed but reaches implementation when both seeds are complete', () => {
    expect(nightly).toMatch(/Studio backlog seed completed\."\s*\r?\n\s*exit 0/);
    expect(nightly).toMatch(/enterprise backlog seed completed\."\s*\r?\n\s*exit 0/);
    const continuation = nightly.indexOf('Continuing to the implementation queue.');
    const issueLookup = nightly.indexOf('Looking for Issues labeled agent-implement');
    expect(continuation).toBeGreaterThan(-1);
    expect(issueLookup).toBeGreaterThan(continuation);
    expect(nightly.slice(continuation, issueLookup)).not.toMatch(/exit 0/);
  });

  it('preserves LENS, CI, and verified merge gates', () => {
    expect(nightly).toContain('Wait-ForLensReview $prNumber');
    expect(nightly).toContain('Wait-ForQualityChecks $prNumber');
    expect(nightly).toMatch(/gh pr merge .*--squash --delete-branch/);
    expect(nightly).not.toMatch(/gh pr merge .*--admin/);
    expect(nightly).toMatch(/\$mergedState -ne 'MERGED'/);
  });
});
