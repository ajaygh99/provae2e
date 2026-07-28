import axios from 'axios';
import { resolveSelectorWithOllama } from '../../src/core/ollama-selector-resolver';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const candidates = [
  { index: 2, tag: 'button', text: 'Place order', score: 0.7 },
  { index: 4, tag: 'button', text: 'Cancel', score: 0.2 }
];

describe('local Ollama selector resolution', () => {
  it('accepts a high-confidence candidate from a compact response', async () => {
    mockedAxios.post.mockResolvedValue({ data: { response: '{"index":2,"confidence":0.95}' } });
    await expect(resolveSelectorWithOllama('submit order', candidates)).resolves.toBe(2);
  });

  it('rejects uncertainty and degrades safely when Ollama is offline', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: '{"index":2,"confidence":0.6}' } });
    await expect(resolveSelectorWithOllama('submit order', candidates)).resolves.toBeUndefined();
    mockedAxios.post.mockRejectedValueOnce(new Error('offline'));
    await expect(resolveSelectorWithOllama('submit order', candidates)).resolves.toBeUndefined();
  });

  it('redacts token-like content before local inference', async () => {
    mockedAxios.post.mockResolvedValue({ data: { response: '{"index":2,"confidence":0.95}' } });
    await resolveSelectorWithOllama('token=super-secret-value', [
      { index: 2, tag: 'button', text: 'Use ghp_1234567890abcdef now', score: 0.7 }
    ]);
    const request = mockedAxios.post.mock.calls.at(-1)?.[1] as { prompt: string };
    expect(request.prompt).not.toContain('super-secret-value');
    expect(request.prompt).not.toContain('ghp_1234567890abcdef');
    expect(request.prompt).toContain('[REDACTED');
  });
});
