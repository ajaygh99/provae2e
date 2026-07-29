import {
  findNativeElement,
  validateNativeSelectors,
  type NativeSelectorCandidate
} from '../../src/core/native-appium-selector';
import type { AppiumFetch } from '../../src/core/native-appium-runner';

describe('native Appium selectors', () => {
  const chain: NativeSelectorCandidate[] = [
    { strategy: 'accessibility id', value: 'login-button' },
    { strategy: 'id', value: 'com.prova:id/login' },
    { strategy: 'xpath', value: '//android.widget.Button[@text="Login"]' }
  ];

  it('requires accessibility ID as the deterministic first tier', () => {
    expect(() => validateNativeSelectors(chain.slice(1))).toThrow('accessibility id');
  });

  it('rejects duplicate, empty, oversized, and unguarded XPath selectors', () => {
    expect(() => validateNativeSelectors([
      chain[0] as NativeSelectorCandidate,
      { strategy: 'accessibility id', value: 'duplicate' }
    ])).toThrow('Duplicate');
    expect(() => validateNativeSelectors([{ strategy: 'accessibility id', value: ' ' }])).toThrow('1 to 2048');
    expect(() => validateNativeSelectors([{ strategy: 'accessibility id', value: 'x'.repeat(2049) }])).toThrow('1 to 2048');
    expect(() => validateNativeSelectors([
      chain[0] as NativeSelectorCandidate,
      { strategy: 'xpath', value: '/absolute/path' }
    ])).toThrow('relative descendant');
  });

  it('tries candidates in order and reports the successful tier', async () => {
    const requests: string[] = [];
    const fetcher: AppiumFetch = jest.fn(async (_input, init) => {
      const request = JSON.parse(init?.body ?? '{}') as { using: string };
      requests.push(request.using);
      const found = request.using === 'id';
      return {
        ok: found,
        status: found ? 200 : 404,
        json: async () => found
          ? { value: { 'element-6066-11e4-a52e-4f735466cecf': 'element-24' } }
          : { value: { error: 'no such element' } }
      };
    });

    await expect(findNativeElement('http://localhost:4723/', 'session/id', chain, fetcher))
      .resolves.toEqual({ elementId: 'element-24', strategy: 'id', candidateIndex: 1 });
    expect(requests).toEqual(['accessibility id', 'id']);
  });

  it('supports the legacy JSON Wire element key and fails after all tiers', async () => {
    const success: AppiumFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ value: { ELEMENT: 'legacy-element' } })
    }));
    await expect(findNativeElement('http://localhost:4723', 'session', [chain[0] as NativeSelectorCandidate], success))
      .resolves.toMatchObject({ elementId: 'legacy-element' });

    const missing: AppiumFetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({})
    }));
    await expect(findNativeElement('http://localhost:4723', 'session', chain, missing))
      .rejects.toThrow('Unable to resolve');
  });
});
