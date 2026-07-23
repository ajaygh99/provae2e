/**
 * AI-powered root cause analysis for complete 7-stage Golden Thread chains.
 *
 * Analyzes failures across the entire test lifecycle and classifies root causes
 * into: Test Gap, Code Bug, Spec Gap, or Deployment. Supports both Claude API
 * and local Ollama models with graceful degradation.
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from './logger.js';
import type { GoldenThreadChain, StageLog } from './golden-thread-store.js';
import Anthropic from '@anthropic-ai/sdk';

/** Root cause classification types. */
export type RootCauseType = 'TEST_GAP' | 'CODE_BUG' | 'SPEC_GAP' | 'DEPLOYMENT';

/** Options for root cause analysis. */
export interface AnalysisOptions {
  /** Use local Ollama model instead of Claude API. */
  local?: boolean;
  /** Skip cache and force re-analysis. */
  skipCache?: boolean;
  /** Run deterministic local analysis without calling any external AI API. */
  offline?: boolean;
}

/** Result of AI-powered root cause analysis. */
export interface RootCauseAnalysis {
  /** Unique identifier for this analysis. */
  id: string;
  /** Reference to the Golden Thread chain being analyzed. */
  golden_thread_id: string;
  /** Classified root cause. */
  root_cause: RootCauseType;
  /** Confidence score (0.7-1.0). */
  confidence: number;
  /** Explanation of why this cause was selected. */
  reasoning: string;
  /** Actionable next steps. */
  suggestions: string[];
  /** ISO timestamp when analysis was performed. */
  timestamp: string;
  /** AI model used ('claude' or 'ollama'). */
  model_used: string;
  /** Whether this result came from cache. */
  cached: boolean;
}

/** Feedback for the learning loop. */
export interface AnalysisFeedback {
  /** Whether the analysis was correct. */
  correct: boolean;
  /** Actual root cause if the analysis was incorrect. */
  actualCause?: RootCauseType;
}

/**
 * AI-powered root cause analyzer for Golden Thread failures.
 *
 * @example
 * ```typescript
 * const analyzer = await RootCauseAnalyzer.open('./analysis-store.sqlite');
 * const analysis = await analyzer.analyzeChain(chain, { local: false });
 * console.log(analysis.root_cause, analysis.confidence);
 * await analyzer.recordFeedback(analysis.id, true);
 * ```
 */
export class RootCauseAnalyzer {
  private db: SqlJsDatabase;
  private filePath: string;
  private anthropic: Anthropic;

  /**
   * Creates a new analyzer instance (private; use {@link open}).
   */
  private constructor(db: SqlJsDatabase, filePath: string) {
    this.db = db;
    this.filePath = filePath;
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Opens or creates a new SQLite store for analysis cache and feedback.
   * Initializes schema on first use.
   *
   * @param filePath - Path to SQLite database file.
   * @returns New analyzer instance.
   */
  static async open(filePath: string): Promise<RootCauseAnalyzer> {
    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });

    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();

    // Create schema if not exists
    db.run(`
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        golden_thread_id TEXT NOT NULL,
        root_cause TEXT NOT NULL,
        confidence REAL NOT NULL,
        reasoning TEXT NOT NULL,
        suggestions TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        model_used TEXT NOT NULL,
        context_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        correct INTEGER NOT NULL,
        actual_cause TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (analysis_id) REFERENCES analyses(id)
      );

      CREATE INDEX IF NOT EXISTS idx_analyses_thread ON analyses(golden_thread_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON feedback(analysis_id);
    `);

    const analyzer = new RootCauseAnalyzer(db, filePath);
    await analyzer.persist();
    log.info('Root cause analyzer database initialized', { filePath });
    return analyzer;
  }

  /**
   * Persists the database to disk.
   */
  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const bytes = this.db.export();
    const buffer = Buffer.from(bytes);
    await writeFile(this.filePath, buffer);
  }

  /**
   * Analyzes a complete Golden Thread chain to determine root cause of failure.
   * Caches results to avoid re-analyzing identical chains.
   *
   * @param chain - Golden Thread chain to analyze.
   * @param options - Analysis options (local model, skip cache).
   * @returns Root cause analysis result.
   */
  async analyzeChain(
    chain: GoldenThreadChain,
    options: AnalysisOptions = {}
  ): Promise<RootCauseAnalysis> {
    const contextHash = this.hashChainContext(chain);

    // Check cache unless explicitly skipped
    if (!options.skipCache) {
      const cached = this.getCachedAnalysis(chain.golden_thread_id, contextHash);
      if (cached) {
        log.info('Root cause analysis cache hit', {
          golden_thread_id: chain.golden_thread_id,
          model: cached.model_used,
        });
        return { ...cached, cached: true };
      }
    }

    // Build full context from chain
    const prompt = this.buildPrompt(chain);

    // Perform analysis via Claude or Ollama
    let analysis: RootCauseAnalysis;
    try {
      if (options.offline) {
        analysis = this.analyzeOffline(chain);
      } else if (options.local) {
        analysis = await this.analyzeViaOllama(chain, prompt);
      } else {
        analysis = await this.analyzeViaClaudeAPI(chain, prompt);
      }
    } catch (err) {
      // Graceful degradation: return a minimal error result
      log.warn('Root cause analysis failed, degrading gracefully', {
        error: String(err),
        golden_thread_id: chain.golden_thread_id,
      });
      return {
        id: this.generateId(),
        golden_thread_id: chain.golden_thread_id,
        root_cause: 'CODE_BUG', // Default assumption
        confidence: 0.5, // Low confidence
        reasoning: 'Analysis unavailable; defaulting to Code Bug',
        suggestions: ['Review CI/CD logs', 'Check test output for details'],
        timestamp: new Date().toISOString(),
        model_used: 'none',
        cached: false,
      };
    }

    // Cache the result
    await this.cacheAnalysis(chain.golden_thread_id, contextHash, analysis);
    log.info('Root cause analysis complete', {
      golden_thread_id: chain.golden_thread_id,
      root_cause: analysis.root_cause,
      confidence: analysis.confidence,
      model: analysis.model_used,
    });

    return { ...analysis, cached: false };
  }

  /**
   * Records user feedback on whether an analysis was correct.
   * Used to refine future analyses.
   *
   * @param analysisId - ID of the analysis being reviewed.
   * @param correct - Whether the analysis was correct.
   * @param actualCause - Actual root cause if analysis was incorrect.
   */
  async recordFeedback(
    analysisId: string,
    correct: boolean,
    actualCause?: RootCauseType
  ): Promise<void> {
    try {
      const feedbackId = this.generateId();
      const timestamp = new Date().toISOString();

      this.db.run(
        `INSERT INTO feedback (id, analysis_id, correct, actual_cause, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
        [feedbackId, analysisId, correct ? 1 : 0, actualCause || null, timestamp]
      );

      await this.persist();

      log.info('Analysis feedback recorded', {
        analysis_id: analysisId,
        correct,
        actual_cause: actualCause || 'N/A',
      });
    } catch (err) {
      log.warn('Failed to record feedback', {
        error: String(err),
        analysis_id: analysisId,
      });
    }
  }

  /**
   * Performs root cause analysis via Claude API.
   */
  private async analyzeViaClaudeAPI(
    chain: GoldenThreadChain,
    prompt: string
  ): Promise<RootCauseAnalysis> {
    const message = await this.anthropic.messages.create({
      model: process.env.PROVA_ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Parse response
    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';
    const parsed = this.parseAnalysisResponse(responseText);

    return {
      id: this.generateId(),
      golden_thread_id: chain.golden_thread_id,
      root_cause: parsed.root_cause,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      suggestions: parsed.suggestions,
      timestamp: new Date().toISOString(),
      model_used: 'claude',
      cached: false,
    };
  }

  /**
   * Provides deterministic analysis for tests and disconnected environments.
   * This path never makes a network request or consumes AI tokens.
   */
  private analyzeOffline(chain: GoldenThreadChain): RootCauseAnalysis {
    const failedStages = chain.stages.filter((stage) => stage.status === 'FAILED');
    const firstFailure = failedStages.sort((a, b) => a.stage - b.stage)[0];
    let rootCause: RootCauseType = 'CODE_BUG';

    if (!chain.stages.some((stage) => stage.stage === 1)) rootCause = 'SPEC_GAP';
    else if (!chain.stages.some((stage) => stage.stage === 2)) rootCause = 'TEST_GAP';
    else if (firstFailure?.stage === 5) rootCause = 'DEPLOYMENT';

    return {
      id: this.generateId(),
      golden_thread_id: chain.golden_thread_id,
      root_cause: rootCause,
      confidence: 0.7,
      reasoning: firstFailure
        ? `Deterministic analysis identified the first failure at Stage ${firstFailure.stage}.`
        : 'Deterministic analysis found no explicit failed stage; review code and evidence.',
      suggestions: [
        'Review the first failing Golden Thread stage',
        'Compare its artifact with the preceding successful stage',
        'Add a regression test after confirming the cause',
      ],
      timestamp: new Date().toISOString(),
      model_used: 'offline',
      cached: false,
    };
  }

  /**
   * Performs root cause analysis via local Ollama model.
   */
  private async analyzeViaOllama(
    chain: GoldenThreadChain,
    prompt: string
  ): Promise<RootCauseAnalysis> {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3:14b',
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as { response: string };
    const parsed = this.parseAnalysisResponse(data.response);

    return {
      id: this.generateId(),
      golden_thread_id: chain.golden_thread_id,
      root_cause: parsed.root_cause,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      suggestions: parsed.suggestions,
      timestamp: new Date().toISOString(),
      model_used: 'ollama',
      cached: false,
    };
  }

  /**
   * Builds a comprehensive prompt from the full 7-stage Golden Thread chain.
   */
  private buildPrompt(chain: GoldenThreadChain): string {
    const stageMap = new Map<number, StageLog | undefined>();
    for (const log of chain.stages) {
      stageMap.set(log.stage, log);
    }

    const formatStage = (_stage: number, log: StageLog | undefined): string => {
      if (!log) return 'N/A';
      const metadata = log.metadata ? JSON.parse(log.metadata) : {};
      const metaText = Object.entries(metadata)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      return `${log.status} | ${log.actor} | ${metaText}`.substring(0, 300);
    };

    const stages = [
      `Stage 1 (Spec): ${formatStage(1, stageMap.get(1))}`,
      `Stage 2 (Test): ${formatStage(2, stageMap.get(2))}`,
      `Stage 3 (Evidence): ${formatStage(3, stageMap.get(3))}`,
      `Stage 4 (Build): ${formatStage(4, stageMap.get(4))}`,
      `Stage 5 (Deploy): ${formatStage(5, stageMap.get(5))} | Deployment: ${stageMap.get(5)?.deployment_status || 'N/A'}`,
      `Stage 6 (Monitor): ${formatStage(6, stageMap.get(6))}`,
      `Stage 7 (Debug): ${formatStage(7, stageMap.get(7))}`,
    ].join('\n\n');

    return `You are a QA expert analyzing a failed test in a CI/CD pipeline. Based on the following 7-stage Golden Thread context, classify the root cause into exactly one category:

${stages}

Analyze the complete chain and respond in this exact format:
ROOT_CAUSE: [TEST_GAP|CODE_BUG|SPEC_GAP|DEPLOYMENT]
CONFIDENCE: [0.7-1.0]
REASONING: [Explanation of why this cause was selected]
SUGGESTIONS:
- [Actionable suggestion 1]
- [Actionable suggestion 2]
- [Actionable suggestion 3]

Be concise and direct.`;
  }

  /**
   * Parses the AI response into structured analysis fields.
   */
  private parseAnalysisResponse(responseText: string): {
    root_cause: RootCauseType;
    confidence: number;
    reasoning: string;
    suggestions: string[];
  } {
    const rootCauseMatch = responseText.match(
      /ROOT_CAUSE:\s*(TEST_GAP|CODE_BUG|SPEC_GAP|DEPLOYMENT)/i
    );
    const confidenceMatch = responseText.match(/CONFIDENCE:\s*(0\.\d+)/);
    const reasoningMatch = responseText.match(
      /REASONING:\s*(.+?)(?=SUGGESTIONS:|$)/s
    );
    const suggestionsMatch = responseText.match(/SUGGESTIONS:([\s\S]*?)$/);

    const root_cause = (rootCauseMatch?.[1] || 'CODE_BUG') as RootCauseType;
    const confidence = Math.max(
      0.7,
      Math.min(1.0, parseFloat(confidenceMatch?.[1] || '0.8'))
    );
    const reasoning = (reasoningMatch?.[1] || '').trim();
    const suggestions = suggestionsMatch
      ? suggestionsMatch[1]
          .split('\n')
          .filter((s) => s.trim().startsWith('-'))
          .map((s) => s.replace(/^-\s*/, '').trim())
          .filter((s) => s.length > 0)
      : [];

    return {
      root_cause,
      confidence,
      reasoning,
      suggestions: suggestions.slice(0, 3), // Limit to 3
    };
  }

  /**
   * Generates a stable hash of the chain context for caching.
   */
  private hashChainContext(chain: GoldenThreadChain): string {
    const logs = chain.stages.map((s) => `${s.stage}:${s.status}:${s.metadata}`).join('|');
    return createHash('sha256').update(logs).digest('hex');
  }

  /**
   * Retrieves a cached analysis if one exists.
   */
  private getCachedAnalysis(
    threadId: string,
    contextHash: string
  ): RootCauseAnalysis | null {
    try {
      const results = this.db.exec(
        `SELECT * FROM analyses WHERE golden_thread_id = ? AND context_hash = ? ORDER BY timestamp DESC LIMIT 1`,
        [threadId, contextHash]
      );

      if (!results || results.length === 0 || !results[0].values || results[0].values.length === 0) {
        return null;
      }

      const cols = results[0].columns;
      const row = results[0].values[0] as (string | number | null)[];

      const rowMap: Record<string, unknown> = {};
      cols.forEach((col, idx) => {
        rowMap[col] = row[idx];
      });

      return {
        id: rowMap.id as string,
        golden_thread_id: rowMap.golden_thread_id as string,
        root_cause: rowMap.root_cause as RootCauseType,
        confidence: rowMap.confidence as number,
        reasoning: rowMap.reasoning as string,
        suggestions: JSON.parse(rowMap.suggestions as string),
        timestamp: rowMap.timestamp as string,
        model_used: rowMap.model_used as string,
        cached: true,
      };
    } catch (err) {
      log.warn('Cache retrieval failed', { error: String(err) });
      return null;
    }
  }

  /**
   * Caches an analysis result for future lookups.
   */
  private async cacheAnalysis(
    threadId: string,
    contextHash: string,
    analysis: RootCauseAnalysis
  ): Promise<void> {
    try {
      this.db.run(
        `INSERT OR REPLACE INTO analyses
         (id, golden_thread_id, root_cause, confidence, reasoning, suggestions, timestamp, model_used, context_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          analysis.id,
          threadId,
          analysis.root_cause,
          analysis.confidence,
          analysis.reasoning,
          JSON.stringify(analysis.suggestions),
          analysis.timestamp,
          analysis.model_used,
          contextHash,
        ]
      );
      await this.persist();
    } catch (err) {
      log.warn('Cache write failed', { error: String(err) });
    }
  }

  /**
   * Generates a unique ID for analyses and feedback.
   */
  private generateId(): string {
    return `rca_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}
