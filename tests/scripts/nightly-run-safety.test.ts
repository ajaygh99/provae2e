/**
 * scripts/nightly-run.ps1 safety hardening — regression checks for three bugs:
 * (1) a dirty/uncommitted working tree was silently auto-stashed and the run
 *     continued, instead of aborting for a human to inspect;
 * (2) several critical git commands (checkout/pull/push) either had no exit-code
 *     check at all, or explicitly logged a warning and "continued anyway" on
 *     failure, instead of failing the run immediately;
 * (3) nothing prevented two overlapping/concurrent invocations of the script
 *     from picking up and processing the same Issue at once.
 *
 * There's no PowerShell test runner in this repo (see lens-single-path.test.ts
 * for the same rationale), so these are static checks over the script source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('nightly-run.ps1 — dirty working tree aborts instead of auto-stashing', () => {
  const script = readFileSync(path.join(__dirname, '../../scripts/nightly-run.ps1'), 'utf-8');

  it('does not silently stash a dirty tree and continue', () => {
    expect(script).not.toMatch(/git stash push/);
  });

  it('aborts (exit 1) when the working tree is not clean at start', () => {
    const dirtyBlockMatch = script.match(/\$dirty = git status --porcelain([\s\S]{0,300})/);
    expect(dirtyBlockMatch).not.toBeNull();
    const dirtyBlock = dirtyBlockMatch?.[1] ?? '';
    expect(dirtyBlock).toMatch(/if\s*\(\$dirty\)/);
    expect(dirtyBlock).toMatch(/exit 1/);
  });
});

describe('nightly-run.ps1 — critical git commands fail fast instead of continuing silently', () => {
  const script = readFileSync(path.join(__dirname, '../../scripts/nightly-run.ps1'), 'utf-8');

  it('no longer contains the old "continue anyway on failure" pattern for git pull', () => {
    expect(script).not.toMatch(/continuing with local state anyway/);
  });

  it('every `git checkout main` and `git pull origin main` call is immediately followed by a failure check that exits', () => {
    const patterns = [/git checkout main \| Out-Null/g, /git pull origin main \| Out-Null/g];

    for (const pattern of patterns) {
      const matches = [...script.matchAll(pattern)];
      expect(matches.length).toBeGreaterThan(0);

      for (const match of matches) {
        const after = script.slice(match.index ?? 0, (match.index ?? 0) + 350);
        expect(after).toMatch(/if\s*\(\$LASTEXITCODE -ne 0\)/);
        expect(after).toMatch(/exit 1/);
      }
    }
  });

  it('puts sprint bookkeeping on the protected PR branch and fails fast if that push fails', () => {
    expect(script).not.toMatch(/git push origin main/);
    const pushBlockMatch = script.match(/git push origin \$branch \| Out-Null([\s\S]{0,220})/);
    expect(pushBlockMatch).not.toBeNull();
    expect(pushBlockMatch?.[1]).toMatch(/if\s*\(\$LASTEXITCODE -ne 0\)/);
    expect(pushBlockMatch?.[1]).toMatch(/exit 1/);
  });
});

describe('nightly-run.ps1 — LENS fallback is tied to the current head', () => {
  const script = readFileSync(path.join(__dirname, '../../scripts/nightly-run.ps1'), 'utf-8');

  it('accepts a successful LENS run without a label only when the current head has no blocking findings', () => {
    expect(script).toMatch(/pulls\/\$prNumber\/comments/);
    expect(script).toMatch(/pulls\/\$prNumber\/reviews/);
    expect(script).toMatch(/\$_\.commit_id -eq \$headSha/);
    expect(script).toMatch(/BLOCKER\|MAJOR/);
  });
});

describe('nightly-run.ps1 — Phase 3 seed is one-time and fail-fast', () => {
  const script = readFileSync(path.join(__dirname, '../../scripts/nightly-run.ps1'), 'utf-8');
  const seed = readFileSync(path.join(__dirname, '../../scripts/create-phase3-studio-issues.ps1'), 'utf-8');

  it('runs the idempotent Studio seed only when no Studio epic issue exists', () => {
    expect(script).toMatch(/--label "epic:studio" --limit 1/);
    expect(script).toMatch(/create-phase3-studio-issues\.ps1/);
    expect(script).toMatch(/Phase 3 Studio issue seed failed/);
    expect(seed).toMatch(/\$existingTitles -contains \$issue\.title/);
  });

  it('checks native gh exit codes instead of treating failed commands as success', () => {
    expect(seed).toMatch(/\$result = & gh @args 2>&1[\s\S]{0,180}\$LASTEXITCODE -ne 0/);
  });
});

describe('nightly-run.ps1 — concurrent/overlapping run guard', () => {
  const script = readFileSync(path.join(__dirname, '../../scripts/nightly-run.ps1'), 'utf-8');

  it('acquires a lock file and checks for an already-running process before doing any work', () => {
    expect(script).toMatch(/\$LockFile\s*=/);
    expect(script).toMatch(/System\.Threading\.Mutex/);
    expect(script).toMatch(/\.WaitOne\(0\)/);
    expect(script).toMatch(/Refusing to start a second overlapping run/);
  });

  it('treats a lock file referencing a no-longer-running process as stale rather than blocking forever', () => {
    expect(script).toMatch(/stale lock/i);
  });

  it('releases the lock in a finally block so it is cleaned up on every exit path', () => {
    expect(script).toMatch(/finally\s*\{[\s\S]*Remove-Item \$LockFile/);
    expect(script).toMatch(/finally\s*\{[\s\S]*ReleaseMutex\(\)/);
    expect(script).toMatch(/finally\s*\{[\s\S]*\.Dispose\(\)/);
  });

  it('checks for a dirty tree before attempting checkout or pull', () => {
    const dirtyCheckIndex = script.indexOf('$dirty = git status --porcelain');
    const checkoutIndex = script.indexOf('git checkout main');
    expect(dirtyCheckIndex).toBeGreaterThan(-1);
    expect(checkoutIndex).toBeGreaterThan(-1);
    expect(dirtyCheckIndex).toBeLessThan(checkoutIndex);
  });
});
