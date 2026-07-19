import axios from 'axios';
import { extractFigmaElements, fetchFigmaElements } from '../../src/core/figma-connector';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function axiosFailure(status: number): Error & { isAxiosError: boolean; response: { status: number } } {
  return Object.assign(new Error(`Request failed with status ${status}`), { isAxiosError: true, response: { status } });
}

describe('extractFigmaElements', () => {
  it('walks nested nodes and extracts text and role-like names in document order', () => {
    const elements = extractFigmaElements({
      type: 'FRAME',
      name: 'Login Screen',
      children: [
        { type: 'TEXT', name: 'Heading', characters: 'Welcome back' },
        {
          type: 'GROUP',
          name: 'Form',
          children: [
            { type: 'INSTANCE', name: 'Email Input' },
            { type: 'COMPONENT', name: 'Remember me Checkbox', characters: 'Remember me' },
            { type: 'RECTANGLE', name: 'Decoration' },
            { type: 'INSTANCE', name: 'SubmitButton' }
          ]
        },
        { type: 'TEXT', name: 'Empty copy', characters: '  ' }
      ]
    });

    expect(elements).toEqual([
      { name: 'Heading', type: 'TEXT', text: 'Welcome back' },
      { name: 'Email Input', type: 'INSTANCE' },
      { name: 'Remember me Checkbox', type: 'COMPONENT', text: 'Remember me' },
      { name: 'SubmitButton', type: 'INSTANCE' },
      { name: 'Empty copy', type: 'TEXT' }
    ]);
  });

  it('ignores malformed, unnamed, and non-meaningful nodes', () => {
    expect(extractFigmaElements(null)).toEqual([]);
    expect(extractFigmaElements({ type: 'FRAME', children: [null, { type: 'TEXT' }, { name: 'Background' }] })).toEqual([]);
  });
});

describe('fetchFigmaElements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is never => Boolean((error as { isAxiosError?: boolean })?.isAxiosError)
    );
  });

  it('calls the Figma nodes API and returns elements from a nested frame', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        nodes: {
          '12:34': {
            document: {
              type: 'FRAME',
              name: 'Login',
              children: [{ type: 'TEXT', name: 'Title', characters: 'Sign in' }, { type: 'INSTANCE', name: 'Login Button' }]
            }
          }
        }
      }
    });
    const result = await fetchFigmaElements({
      fileKey: 'AbC_123-key', nodeId: '12:34', apiToken: 'unit-test-token', timeoutMs: 5000
    });
    expect(result).toEqual({
      ok: true,
      fileKey: 'AbC_123-key',
      nodeId: '12:34',
      elements: [{ name: 'Title', type: 'TEXT', text: 'Sign in' }, { name: 'Login Button', type: 'INSTANCE' }]
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.figma.com/v1/files/AbC_123-key/nodes',
      { headers: { 'X-Figma-Token': 'unit-test-token' }, params: { ids: '12:34' }, timeout: 5000 }
    );
  });

  it('returns a clear failure for an empty frame or missing node document', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { nodes: { '1:2': { document: { type: 'FRAME', name: 'Blank' } } } } });
    await expect(fetchFigmaElements({ fileKey: 'file123', nodeId: '1:2', apiToken: 'token' }))
      .resolves.toEqual({ ok: false, error: 'Figma frame 1:2 contains no meaningful named elements' });

    mockedAxios.get.mockResolvedValueOnce({ data: { nodes: {} } });
    await expect(fetchFigmaElements({ fileKey: 'file123', nodeId: '1:2', apiToken: 'token' }))
      .resolves.toEqual({ ok: false, error: 'Figma node 1:2 was not found in file file123' });
  });

  it.each([401, 403])('returns a safe authentication error for HTTP %s', async (status) => {
    mockedAxios.get.mockRejectedValueOnce(axiosFailure(status));
    const result = await fetchFigmaElements({ fileKey: 'file123', nodeId: '1:2', apiToken: 'unit-test-token' });
    expect(!result.ok && result.error).toContain(`authentication failed (${status})`);
    expect(!result.ok && result.error).not.toContain('unit-test-token');
  });

  it('returns a file/node not-found error for HTTP 404', async () => {
    mockedAxios.get.mockRejectedValueOnce(axiosFailure(404));
    await expect(fetchFigmaElements({ fileKey: 'file123', nodeId: '1:2', apiToken: 'token' }))
      .resolves.toEqual({ ok: false, error: 'Figma file file123 or node 1:2 was not found (404)' });
  });

  it('handles a network failure and redacts the token', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('connection failed with unit-test-token'));
    const result = await fetchFigmaElements({ fileKey: 'file123', nodeId: '1:2', apiToken: 'unit-test-token' });
    expect(!result.ok && result.error).toContain('[REDACTED]');
    expect(!result.ok && result.error).not.toContain('unit-test-token');
  });

  it('rejects invalid file keys, node IDs, and blank tokens before any request', async () => {
    const badFile = await fetchFigmaElements({ fileKey: '../secret', nodeId: '1:2', apiToken: 'x' });
    const badNode = await fetchFigmaElements({ fileKey: 'file123', nodeId: ' ', apiToken: 'x' });
    const noToken = await fetchFigmaElements({ fileKey: 'file123', nodeId: '1:2', apiToken: ' ' });
    expect(!badFile.ok && badFile.error).toContain('Invalid Figma file key');
    expect(!badNode.ok && badNode.error).toContain('Invalid Figma node ID');
    expect(!noToken.ok && noToken.error).toContain('FIGMA_API_TOKEN');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
