import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Phase 4 beta release version contract', () => {
  const version = '0.3.5-beta.1';

  it('keeps package and CLI versions aligned', () => {
    const packageJson = JSON.parse(read('package.json')) as { version: string };
    expect(packageJson.version).toBe(version);
    expect(read('src/cli/run.ts')).toContain(`.version('${version}')`);
  });

  it('uses the same version in public release surfaces', () => {
    for (const file of [
      'README.md',
      'CHANGELOG.md',
      `releases/v${version}.md`,
      `releases/v${version}-approval.md`,
      'docs/PHASE4-BETA-GUIDE.md',
    ]) {
      expect(read(file)).toContain(version);
    }
  });

  it('covers every Phase 4 product surface in the release notes', () => {
    const notes = read(`releases/v${version}.md`).toLowerCase();
    for (const surface of [
      'studio',
      'figma',
      'performance',
      'security',
      'analytics',
      'native mobile',
      'github',
      'jira',
      'slack',
    ]) {
      expect(notes).toContain(surface);
    }
  });

  it('does not overstate credentialed or publishing evidence', () => {
    const notes = read(`releases/v${version}.md`);
    expect(notes).toContain('do not claim that live third-party services accepted a request');
    expect(notes).toMatch(/does not authorize or\s+perform `npm publish`/);
  });
});
