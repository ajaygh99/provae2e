import { HealingMemoryStore } from '../../src/core/healing-memory';
import { mkdtemp, rm } from 'node:fs/promises';
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
});
