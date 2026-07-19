/**
 * AI Summary — sends a run's results to a local Ollama instance and prints a
 * plain-English summary to the console. Never blocks or fails the actual
 * test run: an unreachable Ollama, a timeout, or a non-2xx/empty response
 * are all reported as a warning rather than thrown.
 */
import axios from 'axios';
import { log } from './logger.js';
import type { ReportTestCase } from '../reporters/allure-reporter.js';

/** The default local Ollama generate endpoint. */
const DEFAULT_ENDPOINT = 'http://localhost:11434/api/generate';
/** The default local model used for summaries. */
const DEFAULT_MODEL = 'llama3.1:8b';

/** Options accepted by {@link generateAiSummary} and {@link printAiSummary}. */
export interface AiSummaryOptions {
  /** Normalised test cases for this run — any mix of browser/api/mobile results. */
  runs: ReportTestCase[];
  /** Ollama HTTP endpoint. Defaults to {@link DEFAULT_ENDPOINT}. */
  endpoint?: string;
  /** Ollama model name. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /** Request timeout, in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
}

/** Outcome of a {@link generateAiSummary} call. */
export type AiSummaryResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

/** Shape of the fields this module reads from an Ollama `/api/generate` response body. */
interface OllamaGenerateResponse {
  response?: string;
}

/** Builds the plain-English-summary prompt sent to Ollama from a run's normalised test cases. */
function buildPrompt(runs: ReportTestCase[]): string {
  const total = runs.length;
  const passed = runs.filter((run) => run.status === 'PASS').length;
  const failed = total - passed;
  const failures = runs
    .filter((run) => run.status === 'FAIL')
    .map((run) => `- ${run.name}: ${run.error ?? 'unknown error'} (${run.durationMs}ms)`)
    .join('\n');

  return [
    'You are a QA assistant. Summarize this automated test run in plain English for a busy engineer.',
    `Total: ${total}, Passed: ${passed}, Failed: ${failed}.`,
    failures ? `Failures:\n${failures}` : 'No failures.',
    'Keep the summary to 2-4 sentences. Call out the most important failures first.'
  ].join('\n\n');
}

/**
 * Sends a run's results to a local Ollama instance and returns a plain-English summary.
 * Never throws — connection errors, timeouts, and non-2xx or empty responses are all
 * returned as `{ ok: false, error }` so the caller can continue the run unaffected.
 *
 * @param options - The run's test cases and optional Ollama endpoint/model/timeout overrides.
 * @returns The generated summary, or an error describing why one could not be produced.
 */
export async function generateAiSummary(options: AiSummaryOptions): Promise<AiSummaryResult> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL;
  const prompt = buildPrompt(options.runs);

  try {
    const response = await axios.post<OllamaGenerateResponse>(
      endpoint,
      { model, prompt, stream: false },
      { timeout: options.timeoutMs ?? 30000 }
    );

    const summary = response.data.response?.trim();
    if (!summary) {
      return { ok: false, error: 'Ollama returned an empty response' };
    }
    return { ok: true, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Generates an AI summary for a run and prints it to the console.
 * Warns and returns (never throws) when Ollama is unreachable or errors,
 * so `--ai` never blocks or fails the underlying test run.
 *
 * @param options - The run's test cases and optional Ollama endpoint/model/timeout overrides.
 */
export async function printAiSummary(options: AiSummaryOptions): Promise<void> {
  const result = await generateAiSummary(options);
  if (!result.ok) {
    log.warn('AI summary unavailable — continuing without it', { reason: result.error });
    return;
  }
  log.info('AI summary');
  process.stdout.write(result.summary + '\n');
}
