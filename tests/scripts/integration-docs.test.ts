import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('bounded integration documentation', () => {
  const guide = readFileSync(path.join(process.cwd(), 'docs', 'INTEGRATIONS.md'), 'utf8');
  const readme = readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
  const packageJson = require('../../package.json') as { files: string[] };

  it('documents all three approved authentication flows and troubleshooting', () => {
    expect(guide).toContain('GITHUB_TOKEN');
    expect(guide).toContain('JIRA_ACCESS_TOKEN');
    expect(guide).toContain('SLACK_RELEASE_WEBHOOK_URL');
    expect(guide).toContain('Troubleshooting');
    expect(guide).toContain('Cleanup and failure behavior');
  });

  it('records honest experimental status until credentialed evidence exists', () => {
    expect(guide).toContain('no credentialed live end-to-end validation record');
    expect(guide).toMatch(/remain\s+experimental/);
    expect(guide).not.toMatch(/twelve built-in plugins|secure marketplace/i);
  });

  it('links and packages the owner guide', () => {
    expect(readme).toContain('docs/INTEGRATIONS.md');
    expect(packageJson.files).toContain('docs/INTEGRATIONS.md');
  });
});
