/** Sentinel recurring error extraction, clustering, coverage gaps, and trends. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LogEntry } from './production-logs-model.js';
import { textSimilarity } from './incident-pattern-recognizer.js';

export interface SentinelPatternSignature {
  service: string;
  errorType: string;
  messagePrefix: string;
  stackTopFrame: string;
  value: string;
}

export interface SentinelPatternEvent {
  log: LogEntry;
  stackTrace?: string;
}

export interface SentinelPatternCoverage {
  covered: boolean;
  testIds: string[];
  coveragePercent: number;
}

export type SentinelPatternCoverageMatcher =
  (signature: SentinelPatternSignature) => Promise<SentinelPatternCoverage>;

export interface SentinelPatternSummary {
  signature: SentinelPatternSignature;
  count: number;
  firstSeen: string;
  lastSeen: string;
  services: string[];
  coverage: SentinelPatternCoverage;
  dailyTrend: Array<{ date: string; count: number }>;
  spike: boolean;
  spikeRatio: number;
}

export interface SentinelGapReport {
  from: string;
  to: string;
  headline: string;
  topUncoveredPatterns: SentinelPatternSummary[];
  totalPatterns: number;
  uncoveredPatterns: number;
}

export interface SentinelPatternOptions {
  coverageMatcher: SentinelPatternCoverageMatcher;
  similarityThreshold?: number;
  spikeMultiplier?: number;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed Sentinel error-pattern recognizer. */
export class SentinelPatternRecognizer {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly options: Required<Pick<SentinelPatternOptions, 'similarityThreshold' | 'spikeMultiplier'>>
      & Pick<SentinelPatternOptions, 'coverageMatcher'>
  ) {}

  /**
   * Opens or creates the Sentinel pattern store.
   * @param filePath SQLite database path.
   * @param options Coverage and clustering options.
   * @returns Initialized recognizer.
   */
  static async open(filePath: string, options: SentinelPatternOptions): Promise<SentinelPatternRecognizer> {
    if (typeof options.coverageMatcher !== 'function') throw new Error('coverageMatcher is required');
    const similarityThreshold = options.similarityThreshold ?? 0.55;
    const spikeMultiplier = options.spikeMultiplier ?? 2;
    if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
      throw new Error('similarityThreshold must be between 0 and 1');
    }
    if (!Number.isFinite(spikeMultiplier) || spikeMultiplier <= 1) throw new Error('spikeMultiplier must be greater than 1');
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS sentinel_pattern_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT UNIQUE NOT NULL,
        signature TEXT NOT NULL,
        service TEXT NOT NULL,
        error_type TEXT NOT NULL,
        message_prefix TEXT NOT NULL,
        stack_top_frame TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pattern_time ON sentinel_pattern_events(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_pattern_signature ON sentinel_pattern_events(signature);
    `);
    const recognizer = new SentinelPatternRecognizer(path.resolve(filePath), database, {
      coverageMatcher: options.coverageMatcher, similarityThreshold, spikeMultiplier
    });
    await recognizer.persist();
    return recognizer;
  }

  /**
   * Extracts and stores one production error pattern.
   * @param event Production log and optional stack trace.
   * @returns Extracted signature.
   */
  async ingest(event: SentinelPatternEvent): Promise<SentinelPatternSignature> {
    validateEvent(event);
    const signature = extractSentinelPattern(event);
    this.database.run(
      `INSERT OR IGNORE INTO sentinel_pattern_events
       (event_key, signature, service, error_type, message_prefix, stack_top_frame, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        eventKey(event), signature.value, signature.service, signature.errorType,
        signature.messagePrefix, signature.stackTopFrame, new Date(event.log.timestamp).toISOString()
      ]
    );
    await this.persist();
    return signature;
  }

  /**
   * Builds a ranked uncovered-pattern report for a date range.
   * @param from Inclusive range start.
   * @param to Inclusive range end.
   * @param limit Maximum uncovered patterns, default five.
   * @returns Pattern clusters, coverage, and spike trends.
   */
  async gapReport(from: string, to: string, limit = 5): Promise<SentinelGapReport> {
    const start = validDate(from, 'from');
    const end = validDate(to, 'to');
    if (start > end) throw new Error('from must be before or equal to to');
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer');
    const events = this.events(start, end);
    const clusters = clusterEvents(events, this.options.similarityThreshold);
    const summaries: SentinelPatternSummary[] = [];
    for (const cluster of clusters) {
      const representative = cluster[0].signature;
      const coverage = await this.options.coverageMatcher(representative);
      validateCoverage(coverage);
      const dailyTrend = dailyCounts(cluster);
      const spike = detectSpike(dailyTrend, this.options.spikeMultiplier);
      summaries.push({
        signature: representative,
        count: cluster.length,
        firstSeen: cluster.map(item => item.timestamp).sort()[0],
        lastSeen: cluster.map(item => item.timestamp).sort().at(-1) as string,
        services: [...new Set(cluster.map(item => item.signature.service))].sort(),
        coverage,
        dailyTrend,
        spike: spike.detected,
        spikeRatio: spike.ratio
      });
    }
    summaries.sort((left, right) =>
      Number(right.spike) - Number(left.spike) || right.count - left.count || Date.parse(right.lastSeen) - Date.parse(left.lastSeen)
    );
    const uncovered = summaries.filter(item => !item.coverage.covered);
    return {
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
      headline: `Top ${Math.min(limit, uncovered.length)} uncovered error patterns`,
      topUncoveredPatterns: uncovered.slice(0, limit),
      totalPatterns: summaries.length,
      uncoveredPatterns: uncovered.length
    };
  }

  private events(start: number, end: number): StoredPatternEvent[] {
    const result = this.database.exec(
      `SELECT signature, service, error_type, message_prefix, stack_top_frame, occurred_at
       FROM sentinel_pattern_events WHERE occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at`,
      [new Date(start).toISOString(), new Date(end).toISOString()]
    );
    return result[0]?.values.map(row => ({
      signature: {
        value: row[0] as string,
        service: row[1] as string,
        errorType: row[2] as string,
        messagePrefix: row[3] as string,
        stackTopFrame: row[4] as string
      },
      timestamp: row[5] as string
    })) ?? [];
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}

interface StoredPatternEvent { signature: SentinelPatternSignature; timestamp: string }

/** Extracts service, type, normalized message prefix, and top stack frame. */
export function extractSentinelPattern(event: SentinelPatternEvent): SentinelPatternSignature {
  validateEvent(event);
  const service = event.log.tags['service']?.trim() || 'unknown';
  const errorType = extractErrorType(event.log.message);
  const messagePrefix = normalizeMessage(event.log.message).slice(0, 120);
  const stackTopFrame = normalizeFrame(event.stackTrace?.split('\n').find(line => line.trim()) ?? '');
  return {
    service, errorType, messagePrefix, stackTopFrame,
    value: [service, errorType, messagePrefix, stackTopFrame].join('|')
  };
}

/** Detects whether the newest daily count is a configured multiple of prior average. */
export function detectSpike(
  trend: Array<{ date: string; count: number }>,
  multiplier = 2
): { detected: boolean; ratio: number } {
  if (!Number.isFinite(multiplier) || multiplier <= 1) throw new Error('multiplier must be greater than 1');
  if (trend.length < 2) return { detected: false, ratio: 0 };
  const sorted = [...trend].sort((left, right) => left.date.localeCompare(right.date));
  const current = sorted.at(-1)?.count ?? 0;
  const baselineValues = sorted.slice(0, -1).map(item => item.count);
  const baseline = baselineValues.reduce((sum, value) => sum + value, 0) / baselineValues.length;
  const ratio = baseline === 0 ? (current > 0 ? Number.POSITIVE_INFINITY : 0) : current / baseline;
  return { detected: current > baseline && ratio >= multiplier, ratio };
}

function clusterEvents(events: StoredPatternEvent[], threshold: number): StoredPatternEvent[][] {
  const clusters: StoredPatternEvent[][] = [];
  for (const event of events) {
    const match = clusters.find(cluster => {
      const representative = cluster[0].signature;
      const sameType = representative.errorType === event.signature.errorType;
      const similarity = textSimilarity(
        `${representative.errorType} ${representative.messagePrefix} ${representative.stackTopFrame}`,
        `${event.signature.errorType} ${event.signature.messagePrefix} ${event.signature.stackTopFrame}`
      );
      return sameType && similarity >= threshold;
    });
    if (match) match.push(event);
    else clusters.push([event]);
  }
  return clusters;
}

function dailyCounts(events: StoredPatternEvent[]): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>();
  events.forEach(event => {
    const date = event.timestamp.slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  });
  return [...counts.entries()].sort().map(([date, count]) => ({ date, count }));
}

function extractErrorType(message: string): string {
  const match = message.match(/\b([A-Za-z][A-Za-z0-9]*(?:Exception|Error|Timeout))\b/i);
  if (match) return match[1].toLowerCase();
  if (/timed?\s*out/i.test(message)) return 'timeout';
  return 'error';
}

function normalizeMessage(message: string): string {
  return message.toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '<id>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFrame(frame: string): string {
  return frame.trim().replace(/:\d+:\d+/g, ':<n>:<n>').replace(/\s+/g, ' ').toLowerCase();
}

function eventKey(event: SentinelPatternEvent): string {
  return [event.log.source, event.log.timestamp, event.log.deployment_sha, event.log.message, event.stackTrace ?? ''].join('|');
}

function validateEvent(event: SentinelPatternEvent): void {
  if (!event.log.message.trim()) throw new Error('Log message is required');
  if (!Number.isFinite(Date.parse(event.log.timestamp))) throw new Error('Log timestamp must be valid');
}

function validateCoverage(coverage: SentinelPatternCoverage): void {
  if (!Number.isFinite(coverage.coveragePercent) || coverage.coveragePercent < 0 || coverage.coveragePercent > 100) {
    throw new Error('coveragePercent must be between 0 and 100');
  }
  if (coverage.covered && coverage.testIds.length === 0) throw new Error('Covered patterns require at least one test id');
}

function validDate(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid date`);
  return timestamp;
}
