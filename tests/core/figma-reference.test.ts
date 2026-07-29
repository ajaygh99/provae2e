import { normalizeFigmaNodeId, parseFigmaReference } from '../../src/core/figma-reference';

describe('parseFigmaReference', () => {
  it.each([
    'https://www.figma.com/design/AbCdEf_123/App?node-id=12-34',
    'https://figma.com/file/AbCdEf_123/App?node-id=12%3A34',
    'https://figma.com/proto/AbCdEf_123/App?node-id=12-34',
    'https://figma.com/board/AbCdEf_123/Flow?node-id=12-34'
  ])('parses a copied URL: %s', (url) => {
    expect(parseFigmaReference(url)).toEqual({
      ok: true,
      reference: { fileKey: 'AbCdEf_123', nodeId: '12:34' }
    });
  });

  it('parses and canonicalizes an explicit key pair', () => {
    expect(parseFigmaReference('AbCdEf_123', '12-34')).toEqual({
      ok: true,
      reference: { fileKey: 'AbCdEf_123', nodeId: '12:34' }
    });
    expect(normalizeFigmaNodeId('12%3A34')).toBe('12:34');
  });

  it.each([
    ['http://figma.com/design/key/name?node-id=1-2', undefined, 'https://figma.com'],
    ['https://evil.example/design/key/name?node-id=1-2', undefined, 'https://figma.com'],
    ['https://figma.com/community/file/key?node-id=1-2', undefined, 'design, file, prototype, or board'],
    ['https://figma.com/design/key/name', undefined, 'node ID'],
    ['../secret', '1:2', 'file key'],
    ['key', '../node', 'node ID'],
    ['bad%ZZ', '1:2', 'malformed URL encoding']
  ])('rejects an unsafe reference', (input, nodeId, message) => {
    const result = parseFigmaReference(input, nodeId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});
