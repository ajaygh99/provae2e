/** Optional local-Ollama resolver for ambiguous, sanitized selector candidates. */
import axios from 'axios';
import type { SelectorCandidateSummary } from './adaptive-selector.js';

export interface OllamaSelectorOptions {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
}

function redact(value: string): string {
  return value
    .replace(/\b(?:gh[pousr]_|github_pat_)[a-z0-9_]{8,}\b/gi, '[REDACTED_TOKEN]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[REDACTED_TOKEN]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]{8,}\b/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/\b(password|passwd|token|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
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
    text: redact(candidate.text).slice(0, 80),
    testId: candidate.testId ? redact(candidate.testId).slice(0, 80) : undefined,
    id: candidate.id ? redact(candidate.id).slice(0, 80) : undefined,
    ariaLabel: candidate.ariaLabel ? redact(candidate.ariaLabel).slice(0, 80) : undefined,
    localScore: candidate.score
  }));
  const prompt = `Choose the single element matching intent "${redact(intentKey).slice(0, 120)}". ` +
    `Return strict JSON {"index":number,"confidence":number}. Candidates: ${JSON.stringify(compact)}`;
  try {
    const response = await axios.post<{ response?: string }>(
      options.endpoint ?? 'http://127.0.0.1:11434/api/generate',
      { model: options.model ?? 'qwen3:8b', prompt, stream: false },
      { timeout: options.timeoutMs ?? 5_000 }
    );
    const parsed = JSON.parse(response.data.response ?? '{}') as { index?: unknown; confidence?: unknown };
    if (typeof parsed.index !== 'number' || typeof parsed.confidence !== 'number' || parsed.confidence < 0.9) return undefined;
    return compact.some(candidate => candidate.index === parsed.index) ? parsed.index : undefined;
  } catch {
    return undefined;
  }
}
