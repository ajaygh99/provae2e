import { validateRunOptions, VALID_RUN_TYPES, type RunOptionsInput } from '../../src/cli/validate';

function baseInput(overrides: Partial<RunOptionsInput> = {}): RunOptionsInput {
  return {
    url: 'https://example.com',
    type: 'browser',
    device: 'iPhone14',
    workers: '3',
    env: 'qe',
    scope: 'full',
    method: 'GET',
    expectStatus: '200',
    ...overrides
  };
}

describe('validateRunOptions — --type', () => {
  it('accepts every documented run type, including "all"', () => {
    for (const type of VALID_RUN_TYPES) {
      const result = validateRunOptions(baseInput({ type, method: 'GET', expectStatus: '200' }));
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('rejects an unknown --type with a clear error', () => {
    const result = validateRunOptions(baseInput({ type: 'bogus' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--type') && e.includes('bogus'))).toBe(true);
  });
});

describe('validateRunOptions — --url', () => {
  it('rejects a non-URL string', () => {
    const result = validateRunOptions(baseInput({ url: 'not a url' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--url'))).toBe(true);
  });

  it('rejects a non-http(s) URL scheme', () => {
    const result = validateRunOptions(baseInput({ url: 'ftp://example.com/file' }));
    expect(result.valid).toBe(false);
  });

  it('accepts a valid https URL', () => {
    const result = validateRunOptions(baseInput({ url: 'https://example.com/path?x=1' }));
    expect(result.valid).toBe(true);
  });
});

describe('validateRunOptions — --workers', () => {
  it('rejects zero, negative, and non-integer workers', () => {
    expect(validateRunOptions(baseInput({ workers: '0' })).valid).toBe(false);
    expect(validateRunOptions(baseInput({ workers: '-1' })).valid).toBe(false);
    expect(validateRunOptions(baseInput({ workers: '2.5' })).valid).toBe(false);
    expect(validateRunOptions(baseInput({ workers: 'abc' })).valid).toBe(false);
  });

  it('accepts a positive integer', () => {
    expect(validateRunOptions(baseInput({ workers: '5' })).valid).toBe(true);
  });
});

describe('validateRunOptions — --env and --scope', () => {
  it('rejects an unknown environment', () => {
    const result = validateRunOptions(baseInput({ env: 'production' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--env'))).toBe(true);
  });

  it('rejects an unknown scope', () => {
    const result = validateRunOptions(baseInput({ scope: 'everything' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--scope'))).toBe(true);
  });
});

describe('validateRunOptions — --device (mobile/all only)', () => {
  it('ignores an invalid device when type is browser', () => {
    const result = validateRunOptions(baseInput({ type: 'browser', device: 'FlipPhone2000' }));
    expect(result.valid).toBe(true);
  });

  it('rejects an unsupported device when type is mobile', () => {
    const result = validateRunOptions(baseInput({ type: 'mobile', device: 'FlipPhone2000' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--device'))).toBe(true);
  });

  it('rejects an unsupported device when type is all', () => {
    const result = validateRunOptions(baseInput({ type: 'all', device: 'FlipPhone2000', method: 'GET', expectStatus: '200' }));
    expect(result.valid).toBe(false);
  });

  it('accepts a supported device alias case-insensitively', () => {
    const result = validateRunOptions(baseInput({ type: 'mobile', device: 'pixel7' }));
    expect(result.valid).toBe(true);
  });

  it('accepts an exact Playwright device key for backward compatibility', () => {
    const result = validateRunOptions(baseInput({ type: 'mobile', device: 'iPhone 14 Pro' }));
    expect(result.valid).toBe(true);
  });

  it('accepts a comma-separated list of supported devices', () => {
    const result = validateRunOptions(baseInput({ type: 'all', device: 'iphone14,pixel7' }));
    expect(result.valid).toBe(true);
  });

  it('rejects a list containing an unsupported device', () => {
    const result = validateRunOptions(baseInput({ type: 'mobile', device: 'iphone14,FlipPhone2000' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('FlipPhone2000'))).toBe(true);
  });
});

describe('validateRunOptions — --method and --expect-status (api/all only)', () => {
  it('ignores an invalid method/status when type is browser', () => {
    const result = validateRunOptions(baseInput({ type: 'browser', method: 'PATCH', expectStatus: 'nope' }));
    expect(result.valid).toBe(true);
  });

  it('rejects an unsupported HTTP method for --type api', () => {
    const result = validateRunOptions(baseInput({ type: 'api', method: 'CONNECT' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--method'))).toBe(true);
  });

  it('accepts PATCH for --type api', () => {
    expect(validateRunOptions(baseInput({ type: 'api', method: 'PATCH' })).valid).toBe(true);
  });

  it('rejects a non-numeric --expect-status for --type api', () => {
    const result = validateRunOptions(baseInput({ type: 'api', expectStatus: 'not-a-number' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--expect-status'))).toBe(true);
  });

  it('rejects an out-of-range --expect-status', () => {
    expect(validateRunOptions(baseInput({ type: 'api', expectStatus: '99' })).valid).toBe(false);
    expect(validateRunOptions(baseInput({ type: 'api', expectStatus: '600' })).valid).toBe(false);
  });

  it('accepts a valid method and status code', () => {
    const result = validateRunOptions(baseInput({ type: 'api', method: 'POST', expectStatus: '201' }));
    expect(result.valid).toBe(true);
  });
});

describe('validateRunOptions — --body (api/all only)', () => {
  it('rejects malformed JSON in --body', () => {
    const result = validateRunOptions(baseInput({ type: 'api', body: '{not json' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--body'))).toBe(true);
  });

  it('parses a valid REST body when --graphql is not set', () => {
    const result = validateRunOptions(baseInput({ type: 'api', body: '{"a":1}' }));
    expect(result.valid).toBe(true);
    expect(result.restBody).toEqual({ a: 1 });
    expect(result.graphqlVariables).toBeUndefined();
  });

  it('parses --body as GraphQL variables when --graphql is set', () => {
    const result = validateRunOptions(
      baseInput({ type: 'api', graphql: 'query { me { id } }', body: '{"id":"1"}' })
    );
    expect(result.valid).toBe(true);
    expect(result.graphqlVariables).toEqual({ id: '1' });
    expect(result.restBody).toBeUndefined();
  });

  it('rejects a non-object --body when --graphql is set', () => {
    const arrayResult = validateRunOptions(
      baseInput({ type: 'api', graphql: 'query { me { id } }', body: '[1,2,3]' })
    );
    expect(arrayResult.valid).toBe(false);
    expect(arrayResult.errors.some((e) => e.includes('--graphql'))).toBe(true);

    const stringResult = validateRunOptions(
      baseInput({ type: 'api', graphql: 'query { me { id } }', body: '"just a string"' })
    );
    expect(stringResult.valid).toBe(false);
  });
});

describe('validateRunOptions - device cloud', () => {
  const previousUsername = process.env['BROWSERSTACK_USERNAME'];
  const previousKey = process.env['BROWSERSTACK_ACCESS_KEY'];

  afterEach(() => {
    if (previousUsername === undefined) delete process.env['BROWSERSTACK_USERNAME'];
    else process.env['BROWSERSTACK_USERNAME'] = previousUsername;
    if (previousKey === undefined) delete process.env['BROWSERSTACK_ACCESS_KEY'];
    else process.env['BROWSERSTACK_ACCESS_KEY'] = previousKey;
  });

  it('accepts BrowserStack credentials from flags and cloud-native device names', () => {
    const result = validateRunOptions(baseInput({
      type: 'mobile',
      device: 'Samsung Galaxy S24 Ultra',
      deviceCloud: 'browserstack',
      browserstackUsername: 'user',
      browserstackKey: 'key',
      browserstackParallel: '4',
      browserstackVideo: 'true'
    }));
    expect(result.errors).toEqual([]);
  });

  it('accepts credentials from the standard environment variables', () => {
    process.env['BROWSERSTACK_USERNAME'] = 'user';
    process.env['BROWSERSTACK_ACCESS_KEY'] = 'key';
    expect(validateRunOptions(baseInput({
      type: 'mobile',
      deviceCloud: 'browserstack'
    })).valid).toBe(true);
  });

  it('rejects missing credentials and invalid cloud settings', () => {
    delete process.env['BROWSERSTACK_USERNAME'];
    delete process.env['BROWSERSTACK_ACCESS_KEY'];
    const result = validateRunOptions(baseInput({
      type: 'mobile',
      deviceCloud: 'browserstack',
      browserstackParallel: '30',
      browserstackVideo: 'sometimes'
    }));
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('username is required'),
      expect.stringContaining('access key is required'),
      expect.stringContaining('--browserstack-parallel'),
      expect.stringContaining('--browserstack-video')
    ]));
  });

  it('rejects cloud flags for a non-mobile run', () => {
    const result = validateRunOptions(baseInput({
      type: 'browser',
      deviceCloud: 'browserstack',
      browserstackUsername: 'user',
      browserstackKey: 'key'
    }));
    expect(result.errors).toContain('Device-cloud options require --type mobile or --type all');
  });
});
