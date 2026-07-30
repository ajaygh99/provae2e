import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const script = fs.readFileSync(
  path.join(root, 'scripts/validate-phase4-beta.ps1'),
  'utf8',
);

describe('Phase 4 beta PowerShell orchestrator', () => {
  it.each([
    'validate-phase4-studio.ps1',
    'validate-phase4-figma.ps1',
    'validate-phase4-performance.ps1',
    'validate-phase4-security.ps1',
    'validate-phase4-analytics.ps1',
    'validate-phase4-native.ps1',
    'validate:integrations',
  ])('runs %s', (validator) => {
    expect(script).toContain(validator);
  });

  it.each([
    'Complete Jest regression suite',
    'TypeScript typecheck',
    'Zero-error lint',
    'Production build',
  ])('includes the %s gate', (gate) => {
    expect(script).toContain(gate);
  });

  it('suppresses provider and LLM credentials without recording their values', () => {
    expect(script).toContain(
      "[Environment]::SetEnvironmentVariable($name, $null, 'Process')",
    );
    expect(script).toContain('credentialVariablesSuppressed = $credentialVariables');
    expect(script).not.toContain('credentialValues');
  });

  it('restores the process environment and writes machine-readable evidence', () => {
    expect(script).toContain(
      "[Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')",
    );
    expect(script).toContain('ConvertTo-Json -Depth 5');
    expect(script).toContain('tokenFree = $true');
  });

  it('serializes the Studio Vitest worker pool for deterministic validation', () => {
    expect(script).toContain(
      "[Environment]::SetEnvironmentVariable('VITEST_MAX_THREADS', '1', 'Process')",
    );
    expect(script).toContain('$savedVitestMaxThreads');
  });
});
