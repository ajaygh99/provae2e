import {
  sanitizeIntegrationResult,
  validateIntegrationInput,
  validateIntegrationManifest,
  type IntegrationManifest
} from '../../src/integrations/integration-contract';

const manifest: IntegrationManifest = {
  contractVersion: 1,
  id: 'github',
  owner: 'PROVA Platform',
  actions: ['publish-check', 'link-evidence'],
  secretRefs: { token: 'env:GITHUB_TOKEN' },
  endpoint: 'https://api.github.com',
  timeoutMs: 5000
};

describe('versioned integration contract', () => {
  it('accepts and clones an approved bounded manifest', () => {
    const validated = validateIntegrationManifest(manifest);
    expect(validated).toEqual(manifest);
    expect(validated).not.toBe(manifest);
  });

  it('rejects unapproved integrations, actions, endpoints, and versions', () => {
    expect(() => validateIntegrationManifest({ ...manifest, id: 'marketplace' as 'github' }))
      .toThrow('allowlist');
    expect(() => validateIntegrationManifest({
      ...manifest, actions: ['create-defect']
    })).toThrow('not approved');
    expect(() => validateIntegrationManifest({
      ...manifest, endpoint: 'https://user:secret@example.test'
    })).toThrow('credential-free');
    expect(() => validateIntegrationManifest({ ...manifest, contractVersion: 2 as 1 }))
      .toThrow('version');
  });

  it('requires environment secret references and bounded timeouts', () => {
    expect(() => validateIntegrationManifest({
      ...manifest, secretRefs: { token: 'github_pat_plaintextsecret' }
    })).toThrow('env:VARIABLE');
    expect(() => validateIntegrationManifest({ ...manifest, timeoutMs: 31_000 }))
      .toThrow('between 1000 and 30000');
  });

  it('clones bounded inputs and rejects inline credentials', () => {
    const input = { owner: 'ajaygh99', repository: 'provae2e', conclusion: 'success' };
    expect(validateIntegrationInput(input)).toEqual(input);
    expect(() => validateIntegrationInput({ token: 'ghp_1234567890abcdef' }))
      .toThrow('sensitive');
    expect(() => validateIntegrationInput({ value: 'x'.repeat(70_000) }))
      .toThrow('64 KiB');
  });

  it('redacts provider failures before returning evidence', () => {
    const result = sanitizeIntegrationResult({
      status: 'failure',
      action: 'publish-check',
      message: 'Bearer abcdefghijklmnop was rejected'
    });
    expect(result.message).toContain('[REDACTED_TOKEN]');
    expect(result.message).not.toContain('abcdefghijklmnop');
  });
});
