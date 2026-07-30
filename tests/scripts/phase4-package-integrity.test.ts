import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const script = fs.readFileSync(
  path.join(root, 'scripts/verify-phase4-package.ps1'),
  'utf8',
);

describe('Phase 4 package integrity gate', () => {
  it('packs with lifecycle scripts disabled', () => {
    expect(script).toContain('npm pack --json --ignore-scripts');
  });

  it.each([
    'package/dist/index.js',
    'package/dist/cli/run.js',
    'package/docs/PHASE4-BETA-GUIDE.md',
    'package/releases/v0.3.5-beta.1.md',
  ])('requires %s', (file) => {
    expect(script).toContain(file);
  });

  it('rejects non-release content', () => {
    expect(script).toContain('tests?');
    expect(script).toContain('artifacts');
    expect(script).toContain('\\.env');
    expect(script).toContain("\\.example$");
    expect(script).toContain('\\.(sqlite|log)');
  });

  it('records integrity metadata without publishing', () => {
    expect(script).toContain('Get-FileHash');
    expect(script).toContain('publishPerformed = $false');
    expect(script).not.toContain('npm publish');
  });
});
