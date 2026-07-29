import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('native Appium CI workflow', () => {
  const workflow = readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'native-appium.yml'),
    'utf8'
  );

  it('runs credential-free native contract gates with bounded permissions', () => {
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run validate:native');
    expect(workflow).not.toContain('secrets.');
  });

  it('does not claim emulation as a native device proof', () => {
    expect(workflow).toContain('No emulator or real-device claim is made by this contract-only job');
  });
});
