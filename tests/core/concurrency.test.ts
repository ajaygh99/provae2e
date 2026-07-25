import { mapWithConcurrency } from '../../src/core/concurrency';

describe('mapWithConcurrency', () => {
  it('limits active operations and preserves result order', async () => {
    let active = 0;
    let maximumActive = 0;

    const results = await mapWithConcurrency([30, 5, 10, 1], 2, async (delay, index) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return `result-${index}`;
    });

    expect(maximumActive).toBe(2);
    expect(results).toEqual(['result-0', 'result-1', 'result-2', 'result-3']);
  });

  it('handles an empty collection', async () => {
    await expect(mapWithConcurrency([], 3, async () => 'unused')).resolves.toEqual([]);
  });
});
