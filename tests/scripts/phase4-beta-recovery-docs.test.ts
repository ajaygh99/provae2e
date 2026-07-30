import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (file: string): string =>
  fs.readFileSync(path.join(root, file), 'utf8');

describe('Phase 4 beta recovery documentation', () => {
  const runbook = read('docs/PHASE4-BETA-ROLLBACK.md');
  const approval = read('releases/v0.3.5-beta.1-approval.md');

  it('keeps publication behind an explicit final approval', () => {
    expect(runbook).toMatch(/only after the\s+owner explicitly approves publication/);
    expect(approval).toContain('remain pending a separate explicit owner decision');
  });

  it('defines the bottom-up Phase 4 merge order', () => {
    expect(runbook).toMatch(/Native mobile[\s\S]*Plugin\/integration[\s\S]*Documentation\/release/);
    expect(runbook).toContain('Never rewrite the branch with a force-push');
  });

  it.each([
    'git tag -a phase4-beta-checkpoint-45-of-45',
    'git bundle create phase4-beta-checkpoint.bundle --all',
    'git bundle verify phase4-beta-checkpoint.bundle',
    'Get-FileHash phase4-beta-checkpoint.bundle -Algorithm SHA256',
  ])('documents checkpoint command %s', (command) => {
    expect(runbook).toContain(command);
  });

  it('recovers to a new branch without destructive operations', () => {
    expect(runbook).toContain('git switch -c recovery/phase4-beta');
    expect(runbook).not.toContain('reset --hard');
    expect(runbook).not.toContain('push --force');
  });

  it('defines safe registry rollback behavior', () => {
    expect(runbook).toContain('moving the `beta`');
    expect(runbook).toContain('remove the `beta` dist-tag');
    expect(runbook).toContain('deprecate that exact version');
  });
});
