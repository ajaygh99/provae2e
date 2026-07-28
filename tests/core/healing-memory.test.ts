import { HealingMemoryStore } from '../../src/core/healing-memory';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('HealingMemoryStore', () => {
  let directory: string;
  let store: HealingMemoryStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'prova-healing-'));
    store = new HealingMemoryStore(path.join(directory, 'healing.db'));
    await store.initialize();
  });

  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('promotes repeatedly successful selector strategies', async () => {
    for (let index = 0; index < 4; index++) {
      await store.recordSuccess('/checkout', 'submit-order', { testId: 'submit-order-button' }, 'data-testid');
    }
    expect(store.recommend('/checkout', 'submit-order', 0.8)).toMatchObject({
      tier: 'data-testid', successes: 4
    });
  });

  it('does not recommend low-confidence one-off observations', async () => {
    await store.recordSuccess('/checkout', 'submit-order', { text: 'Place order' }, 'text-content');
    expect(store.recommend('/checkout', 'submit-order', 0.8)).toBeUndefined();
  });

  it('reduces confidence when a remembered strategy fails', async () => {
    for (let index = 0; index < 8; index++) {
      await store.recordSuccess('/checkout', 'submit-order', { css: '#submit' }, 'css-selector');
    }
    const recommendation = store.recommend('/checkout', 'submit-order', 0.8);
    expect(recommendation).toBeDefined();
    await store.recordFailure(recommendation!.id);
    expect(store.recommend('/checkout', 'submit-order', 0.9)).toBeUndefined();
  });

  it('requires 95 percent confidence by default', async () => {
    for (let index = 0; index < 18; index++) {
      await store.recordSuccess('/checkout', 'submit-order', { testId: 'submit' }, 'data-testid');
    }
    expect(store.recommend('/checkout', 'submit-order')).toBeDefined();
    expect(() => store.recommend('/checkout', 'submit-order', 0.79)).toThrow('between 0.8 and 1');
  });

  it('rejects credentials and PII and clears learned selectors', async () => {
    await expect(store.recordSuccess('/account', 'person@company.com', { text: 'Profile' }, 'text-content'))
      .resolves.toBe(false);
    await expect(store.recordSuccess('/account', 'token', { text: 'ghp_1234567890abcdef' }, 'text-content'))
      .resolves.toBe(false);
    const persisted = (await readFile(path.join(directory, 'healing.db'))).toString('utf-8');
    expect(persisted).not.toContain('person@company.com');
    expect(persisted).not.toContain('ghp_1234567890abcdef');
    await store.recordSuccess('/account', 'profile', { testId: 'profile' }, 'data-testid', {
      original: { css: '#old-profile' }, testFile: 'profile.spec.ts', lineNumber: 42, user: 'Ajay'
    });
    expect(await store.clear()).toBe(1);
    expect(store.recommend('/account', 'profile')).toBeUndefined();
  });

  it('removes a specific learned selector during rollback', async () => {
    const descriptor = { testId: 'save' };
    await store.recordSuccess('/settings', 'save', descriptor, 'data-testid');
    expect(await store.remove('/settings', 'save', descriptor, 'data-testid')).toBe(true);
    expect(await store.remove('/settings', 'save', descriptor, 'data-testid')).toBe(false);
  });
});
