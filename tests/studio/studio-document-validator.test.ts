import { validateStudioDocument } from '../../src/studio/studio-document-validator';

describe('validateStudioDocument', () => {
  it.each([
    ['json', JSON.stringify({
      name: 'Checkout',
      url: 'https://example.com',
      browser: 'chromium',
      steps: [{ action: 'navigate' }, { action: 'click', selector: '#buy' }]
    })],
    ['yaml', [
      'name: Checkout',
      'url: https://example.com',
      'steps:',
      '  - action: fill',
      '    selector: "#email"',
      '    value: buyer@example.com'
    ].join('\n')]
  ] as const)('accepts a valid %s definition', (format, content) => {
    const result = validateStudioDocument(content, format);
    expect(result.diagnostics).toEqual([]);
    expect(result.definition?.name).toBe('Checkout');
  });

  it('returns a line-aware JSON syntax error', () => {
    const result = validateStudioDocument('{\n  "name": "broken",\n}', 'json');
    expect(result.diagnostics[0]).toEqual(expect.objectContaining({
      path: '$',
      line: 3,
      message: expect.stringContaining('JSON')
    }));
  });

  it('returns a line-aware YAML syntax error', () => {
    const result = validateStudioDocument('name: [broken\nurl: https://example.com', 'yaml');
    expect(result.diagnostics[0]).toEqual(expect.objectContaining({
      path: '$',
      line: expect.any(Number)
    }));
  });

  it('returns actionable semantic paths for invalid steps', () => {
    const result = validateStudioDocument(JSON.stringify({
      name: '',
      url: 'file:///secret',
      browser: 'edge',
      steps: [
        { action: 'fill', selector: '' },
        { action: 'assert', selector: '#total' },
        { action: 'shell', value: 'rm -rf' }
      ]
    }), 'json');

    expect(result.diagnostics.map(diagnostic => diagnostic.path)).toEqual([
      '$.name',
      '$.url',
      '$.browser',
      '$.steps[0].selector',
      '$.steps[0].value',
      '$.steps[1].expected',
      '$.steps[2].action'
    ]);
  });
});

