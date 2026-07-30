import {
  IntegrationRegistry,
  type IntegrationAdapter
} from '../../src/integrations/integration-registry';

function adapter(overrides: Partial<IntegrationAdapter> = {}): IntegrationAdapter {
  return {
    manifest: {
      contractVersion: 1,
      id: 'github',
      owner: 'PROVA',
      actions: ['publish-check'],
      secretRefs: { token: 'env:GITHUB_TOKEN' },
      timeoutMs: 1000
    },
    initialize: jest.fn().mockResolvedValue(undefined),
    health: jest.fn().mockResolvedValue({
      status: 'healthy', checkedAt: new Date(0).toISOString()
    }),
    execute: jest.fn(async (action, _input, context) => ({
      status: context.getSecret('token') ? 'success' : 'failure',
      action,
      message: 'Bearer abcdefghijklmnop'
    })),
    dispose: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('bounded integration registry', () => {
  it('registers validated local adapters and returns secret-free metadata', async () => {
    const registry = new IntegrationRegistry({ GITHUB_TOKEN: 'secret' });
    const github = adapter();
    await registry.register(github);
    expect(registry.list()).toEqual([{
      id: 'github', owner: 'PROVA', actions: ['publish-check']
    }]);
    expect(JSON.stringify(registry.list())).not.toContain('GITHUB_TOKEN');
    await expect(registry.register(github)).rejects.toThrow('already registered');
  });

  it('resolves secrets only during execution and sanitizes results', async () => {
    const registry = new IntegrationRegistry({ GITHUB_TOKEN: 'runtime-secret' });
    await registry.register(adapter());
    const result = await registry.execute('github', 'publish-check', { conclusion: 'success' });
    expect(result.status).toBe('success');
    expect(result.message).toContain('[REDACTED_TOKEN]');
    expect(JSON.stringify(result)).not.toContain('runtime-secret');
  });

  it('rejects undeclared actions and unavailable secrets', async () => {
    const registry = new IntegrationRegistry({});
    await registry.register(adapter());
    await expect(registry.execute('github', 'link-evidence', {}))
      .rejects.toThrow('does not declare');
    await expect(registry.execute('github', 'publish-check', {}))
      .rejects.toThrow('GITHUB_TOKEN is unavailable');
  });

  it('aborts timed-out adapters', async () => {
    let signal: AbortSignal | undefined;
    const hanging = adapter({
      execute: jest.fn(async (_action, _input, context) => {
        signal = context.signal;
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { status: 'success', action: 'publish-check' };
      }),
      manifest: {
        contractVersion: 1,
        id: 'github',
        owner: 'PROVA',
        actions: ['publish-check'],
        secretRefs: { token: 'env:GITHUB_TOKEN' },
        timeoutMs: 1000
      }
    });
    const registry = new IntegrationRegistry({ GITHUB_TOKEN: 'secret' });
    await registry.register(hanging);
    await expect(registry.execute('github', 'publish-check', {})).rejects.toThrow('timed out');
    expect(signal?.aborted).toBe(true);
  });

  it('disposes all adapters even when one cleanup fails', async () => {
    const registry = new IntegrationRegistry({ GITHUB_TOKEN: 'secret', JIRA_TOKEN: 'secret' });
    const github = adapter({ dispose: jest.fn().mockRejectedValue(new Error('close failed')) });
    const jira = adapter({
      manifest: {
        contractVersion: 1, id: 'jira', owner: 'PROVA',
        actions: ['ingest-requirement'], secretRefs: { token: 'env:JIRA_TOKEN' }
      }
    });
    await registry.register(github);
    await registry.register(jira);
    await expect(registry.disposeAll()).rejects.toThrow('github: close failed');
    expect(jira.dispose).toHaveBeenCalled();
    expect(registry.list()).toEqual([]);
  });
});
