import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Phase 4 beta operator guide', () => {
  const guide = readFileSync(
    path.join(process.cwd(), 'docs', 'PHASE4-BETA-GUIDE.md'),
    'utf8'
  );
  const readme = readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
  const packageJson = require('../../package.json') as { files: string[] };

  it.each([
    'Studio and Figma',
    'Performance',
    'Security',
    'Analytics',
    'Native Android',
    'Integrations'
  ])('documents the %s surface', (surface) => {
    expect(guide).toContain(surface);
  });

  it('states token-free evidence boundaries without overclaiming live proof', () => {
    expect(guide).toContain('No GitHub, Jira, Slack');
    expect(guide).toContain('does not prove');
    expect(guide).toContain('Playwright mobile emulation is not');
    expect(guide).toContain('experimental');
  });

  it('is linked and included in the npm package', () => {
    expect(readme).toContain('docs/PHASE4-BETA-GUIDE.md');
    expect(packageJson.files).toContain('docs/PHASE4-BETA-GUIDE.md');
  });
});
