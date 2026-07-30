import {
  validateNativeSeedFixture,
  withNativeSeedData,
  type NativeSeedAdapter,
  type NativeSeedFixture
} from '../../src/core/native-test-data-seeder';

const fixture: NativeSeedFixture = {
  id: 'login_case',
  tables: {
    users: [{ id: 1, email: 'test@example.test', active: true }]
  }
};

describe('native test-data seeding', () => {
  function adapter(verify = true): NativeSeedAdapter {
    return {
      apply: jest.fn().mockResolvedValue(undefined),
      verify: jest.fn().mockResolvedValue(verify),
      cleanup: jest.fn().mockResolvedValue(undefined)
    };
  }

  it('validates and clones bounded scalar fixtures', () => {
    const validated = validateNativeSeedFixture(fixture);
    expect(validated).toEqual(fixture);
    expect(validated).not.toBe(fixture);
  });

  it('rejects unsafe names, empty records, non-finite values, and oversized strings', () => {
    expect(() => validateNativeSeedFixture({ ...fixture, id: '../unsafe' })).toThrow('fixture ID');
    expect(() => validateNativeSeedFixture({ id: 'empty', tables: { users: [] } }))
      .toThrow('between 1 and 10000');
    expect(() => validateNativeSeedFixture({
      id: 'nan', tables: { users: [{ value: Number.NaN }] }
    })).toThrow('finite');
    expect(() => validateNativeSeedFixture({
      id: 'large', tables: { users: [{ value: 'x'.repeat(10_001) }] }
    })).toThrow('too long');
  });

  it('applies, verifies, runs, and cleans up in order', async () => {
    const events: string[] = [];
    const controlled: NativeSeedAdapter = {
      apply: jest.fn(async () => { events.push('apply'); }),
      verify: jest.fn(async () => { events.push('verify'); return true; }),
      cleanup: jest.fn(async () => { events.push('cleanup'); })
    };
    await expect(withNativeSeedData(controlled, fixture, async () => {
      events.push('test');
      return 'passed';
    })).resolves.toBe('passed');
    expect(events).toEqual(['apply', 'verify', 'test', 'cleanup']);
  });

  it('cleans up after verification and test failures', async () => {
    const verificationFailure = adapter(false);
    await expect(withNativeSeedData(verificationFailure, fixture, async () => undefined))
      .rejects.toThrow('verification failed');
    expect(verificationFailure.cleanup).toHaveBeenCalledWith('login_case');

    const testFailure = adapter();
    await expect(withNativeSeedData(testFailure, fixture, async () => {
      throw new Error('test failed');
    })).rejects.toThrow('test failed');
    expect(testFailure.cleanup).toHaveBeenCalledWith('login_case');
  });

  it('surfaces cleanup failure after a passing test', async () => {
    const controlled = adapter();
    (controlled.cleanup as jest.Mock).mockRejectedValue(new Error('database locked'));
    await expect(withNativeSeedData(controlled, fixture, async () => 'passed'))
      .rejects.toThrow('Native seed cleanup failed');
  });
});
