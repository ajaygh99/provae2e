import {
  parseHeaders,
  validateApiPayload,
  validateDevice,
  validateHeaders,
  validateHttpUrl,
  validatePositiveInteger,
  validateRunType,
  validateWorkers
} from '../../src/core/input-validator';

describe('input validator', () => {
  it.each([
    'http://example.com',
    'https://example.com/path',
    'https://localhost:3000?q=1'
  ])('accepts HTTP URL %s', (value) => expect(validateHttpUrl(value)).toBeUndefined());

  it.each([
    'example.com',
    'ftp://example.com',
    'file:///tmp/test',
    '',
    '://broken'
  ])('rejects invalid HTTP URL %s', (value) => expect(validateHttpUrl(value)).toContain('--url'));

  it.each(['browser', 'api', 'mobile', 'all'])('accepts run type %s', (value) => {
    expect(validateRunType(value)).toBeUndefined();
  });

  it.each(['desktop', 'API', '', 'everything'])('rejects run type %s', (value) => {
    expect(validateRunType(value)).toContain('--type');
  });

  it.each([1, 2, 8, 16, '3'])('accepts worker count %s', (value) => {
    expect(validateWorkers(value)).toBeUndefined();
  });

  it.each([0, -1, 17, 1.5, 'abc'])('rejects worker count %s', (value) => {
    expect(validateWorkers(value)).toContain('between 1 and 16');
  });

  it.each([1, 1000, '30000'])('accepts timeout %s', (value) => {
    expect(validatePositiveInteger(value)).toBeUndefined();
  });

  it.each([0, -1, 1.2, 'later'])('rejects timeout %s', (value) => {
    expect(validatePositiveInteger(value)).toContain('positive integer');
  });

  it.each(['iPhone14', 'pixel7', 'iPhone 14 Pro'])('accepts Playwright device %s', (value) => {
    expect(validateDevice(value)).toBeUndefined();
  });

  it.each(['FlipPhone2000', '', 'iPhone 99'])('rejects unknown device %s', (value) => {
    expect(validateDevice(value)).toContain('--device');
  });

  it('accepts valid custom headers', () => {
    expect(validateHeaders({ Authorization: 'Bearer token', 'x-request-id': '123' })).toEqual([]);
  });

  it('rejects non-object headers', () => {
    expect(validateHeaders(['x-test'])).toHaveLength(1);
  });

  it('rejects a non-string header value', () => {
    expect(validateHeaders({ 'x-count': 3 })).toEqual([
      'Invalid --headers: header "x-count" must have a string value'
    ]);
  });

  it('rejects an invalid header name', () => {
    expect(validateHeaders({ 'bad header': 'value' })[0]).toContain('valid HTTP header');
  });

  it('rejects an invalid header value', () => {
    expect(validateHeaders({ 'x-test': 'bad\r\nvalue' })[0]).toContain('valid HTTP header');
  });

  it('parses valid header JSON', () => {
    expect(parseHeaders('{"Accept":"application/json"}')).toEqual({
      headers: { Accept: 'application/json' },
      errors: []
    });
  });

  it('rejects malformed header JSON', () => {
    expect(parseHeaders('{bad').errors[0]).toContain('valid JSON');
  });

  it('accepts JSON-safe API payloads', () => {
    expect(validateApiPayload({ user: { roles: ['admin'] } })).toEqual([]);
  });

  it('accepts an omitted API payload', () => {
    expect(validateApiPayload(undefined)).toEqual([]);
  });

  it('rejects a circular API payload', () => {
    const payload: Record<string, unknown> = {};
    payload['self'] = payload;
    expect(validateApiPayload(payload)[0]).toContain('not JSON serializable');
  });

  it('rejects a bigint API payload', () => {
    expect(validateApiPayload(BigInt(1))[0]).toContain('not JSON serializable');
  });
});
