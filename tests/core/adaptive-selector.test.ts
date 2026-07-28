import type { Page } from '@playwright/test';
import type { HealingMemoryStore } from '../../src/core/healing-memory';
import { resolveSelector } from '../../src/core/self-healing-selector';
import { tokenSimilarity } from '../../src/core/adaptive-selector';

describe('adaptive selector learning', () => {
  it('scores normalized semantic tokens without an LLM', () => {
    expect(tokenSimilarity('Submit order', 'button submit order now')).toBeGreaterThan(0.6);
    expect(tokenSimilarity('Submit order', 'cancel cart')).toBe(0);
  });

  it('falls back to a changed selector and penalizes stale memory', async () => {
    const oldLocator = { count: jest.fn().mockResolvedValue(0) };
    const newLocator = { count: jest.fn().mockResolvedValue(1) };
    const page = {
      getByTestId: jest.fn((value: string) => value === 'old-submit' ? oldLocator : newLocator)
    } as unknown as Page;
    const store = {
      recommend: jest.fn().mockReturnValue({
        id: 7, descriptor: { testId: 'old-submit' }, tier: 'data-testid',
        confidence: 0.95, successes: 20, failures: 0
      }),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn().mockResolvedValue(undefined)
    } as unknown as HealingMemoryStore;

    const result = await resolveSelector(page, { testId: 'new-submit' }, {
      store, pageKey: '/checkout', intentKey: 'submit-order'
    });

    expect(result.locator).toBe(newLocator);
    expect(store.recordFailure).toHaveBeenCalledWith(7);
    expect(store.recordSuccess).toHaveBeenCalledWith(
      '/checkout', 'submit-order', { testId: 'new-submit' }, 'data-testid'
    );
  });
});
