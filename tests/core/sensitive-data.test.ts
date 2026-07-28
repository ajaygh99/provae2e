import { containsSensitiveData, redactSensitiveData } from '../../src/core/sensitive-data';

describe('sensitive data filtering', () => {
  it.each([
    'person@company.com',
    '123-45-6789',
    '4111 1111 1111 1111',
    'Bearer abcdefghijklmnop',
    'password=top-secret'
  ])('detects and redacts %s', (value) => {
    expect(containsSensitiveData(value)).toBe(true);
    expect(redactSensitiveData(value)).not.toContain(value);
  });

  it('allows reserved example emails used by tests', () => {
    expect(containsSensitiveData('qa@example.com')).toBe(false);
  });
});
