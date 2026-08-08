/** Optional local-Ollama resolver for ambiguous, sanitized selector candidates. */
import axios from 'axios';
import type { SelectorCandidateSummary } from './adaptive-selector.js';
import { redactSensitiveData } from './sensitive-data.js';

export interface OllamaSelectorOptions {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
}

/** Selects one candidate index using local Ollama; returns undefined on uncertainty or failure. */
export async function resolveSelectorWithOllama(
  intentKey: string,
  candidates: SelectorCandidateSummary[],
  options: OllamaSelectorOptions = {}
): Promise<number | undefined> {
  if (!candidates.length) return undefined;
  const compact = candidates.slice(0, 5).map(candidate => ({
    index: candidate.index,
    tag: candidate.tag,
    text: redactSensitiveData(candidate.text).slice(0, 80),
    testId: candidate.testId ? redactSensitiveData(candidate.testId).slice(0, 80) : undefined,
    id: candidate.id ? redactSensitiveData(candidate.id).slice(0, 80) : undefined,
    ariaLabel: candidate.ariaLabel ? redactSensitiveData(candidate.ariaLabel).slice(0, 80) : undefined,
    localScore: candidate.score
  }));
  const prompt = `Choose the single element matching intent "${redactSensitiveData(intentKey).slice(0, 120)}". ` +
    `Return strict JSON {"index":number,"confidence":number}. Candidates: ${JSON.stringify(compact)}`;
  try {
    const response = await axios.post<{ response?: string }>(
      options.endpoint ?? 'http://127.0.0.1:11434/api/generate',
      { model: options.model ?? 'qwen3:8b', prompt, stream: false },
      { timeout: options.timeoutMs ?? 5_000 }
    );
    const parsed = JSON.parse(response.data.response ?? '{}') as { index?: unknown; confidence?: unknown };
    if (typeof parsed.index !== 'number' || typeof parsed.confidence !== 'number' || parsed.confidence < 0.95) return undefined;
    return compact.some(candidate => candidate.index === parsed.index) ? parsed.index : undefined;
  } catch {
    return undefined;
  }
}
