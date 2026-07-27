import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// CommonJS scripts are intentional: they are also executable directly in CI.
const { redact, redactObject, scenarios } = require('../../scripts/slice2-failure-runner.js');
const { scanFile } = require('../../scripts/slice2-validate-evidence.js');

describe('Slice 2 intentional-failure campaign contracts', () => {
  const fixtureDir = path.join(process.cwd(), '.slice2-validator-fixtures');

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('defines 10-15 representative failures across all required categories', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(10);
    expect(scenarios.length).toBeLessThanOrEqual(15);
    expect(new Set(scenarios.map((scenario: { category: string }) => scenario.category))).toEqual(
      new Set(['selector', 'timeout', 'assertion', 'api'])
    );
  });

  it('redacts explicit secrets, authorization values, and sensitive object fields', () => {
    const secret = 'ghp_SyntheticSecret123456789';
    expect(redact(`Bearer ${secret}`, [secret])).toBe('Bearer [REDACTED]');
    expect(redactObject({ password: 'unsafe-password', nested: { token: secret } }, [secret])).toEqual({
      password: '[REDACTED]',
      nested: { token: '[REDACTED]' }
    });
  });

  it('detects a deliberately planted credential in a text artifact', async () => {
    await mkdir(fixtureDir, { recursive: true });
    const fixture = path.join(fixtureDir, 'leak.log');
    await writeFile(fixture, 'authorization: Bearer unsafeSyntheticCredential12345', 'utf8');
    expect(scanFile(fixture)).toEqual(expect.arrayContaining([
      expect.objectContaining({ pattern: 'Authorization value' })
    ]));
  });
});
