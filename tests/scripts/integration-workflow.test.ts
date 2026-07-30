import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('integration contract workflow', () => {
  const workflow = readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'integration-contract.yml'),
    'utf8'
  );
  const packageJson = require('../../package.json') as {
    scripts: Record<string, string>;
  };

  it('runs a credential-free, read-only integration contract gate', () => {
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('npm run validate:integrations');
    expect(workflow).toContain('Credential-free contract validation only');
    expect(workflow).not.toContain('secrets.');
    expect(packageJson.scripts['validate:integrations']).toContain('node ');
  });

  it('does not advertise remote installation or marketplace execution', () => {
    expect(workflow).not.toMatch(/remote.plugin|marketplace|untrusted/i);
  });
});
