/** Sentinel predictive alerting with multi-horizon forecasts and feedback. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ForecastDirection = 'above' | 'below';
export type ForecastHorizonHours = 1 | 4 | 24;

export interface ForecastPoint {
  timestamp: string;
  value: number;
}

export interface ForecastRule {
  id: string;
  service: string;
  metric: string;
  threshold: number;
  direction: ForecastDirection;
  proactiveAction: string;
}

export interface MetricForecast {
  id: string;
  ruleId: string;
  service: string;
  metric: string;
  generatedAt: string;
  horizonHours: ForecastHorizonHours;
  predictedValue: number;
  threshold: number;
  predictedBreach: boolean;
  predictedBreachAt?: string;
  growthPerHour: number;
  alert?: string;
  recommendation?: string;
}

export interface ForecastActionResult {
  executed: boolean;
  detail: string;
}

export interface ForecastActionExecutor {
  execute(action: string, forecast: MetricForecast): Promise<ForecastActionResult>;
}

export interface ForecastFeedback {
  forecastId: string;
  actualValue: number;
  actualTimestamp: string;
  actualBreached: boolean;
}

export interface ForecastAccuracy {
  sampleCount: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
  falsePositiveRate: number;
  averageDetectionLatencyMinutes: number;
}

export interface ForecastRun {
  forecasts: MetricForecast[];
  actionResults: ForecastActionResult[];
}

const HORIZONS: ForecastHorizonHours[] = [1, 4, 24];
let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** Persistent predictive alerting and model-feedback engine. */
export class SentinelForecastingEngine {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly executor?: ForecastActionExecutor,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Opens or creates a forecast history store.
   * @param filePath SQLite database path.
   * @param options Action executor and clock.
   * @returns Initialized engine.
   */
  static async open(
    filePath: string,
    options: { executor?: ForecastActionExecutor; now?: () => Date } = {}
  ): Promise<SentinelForecastingEngine> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS sentinel_forecasts (
        id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, service TEXT NOT NULL,
        metric TEXT NOT NULL, generated_at TEXT NOT NULL, horizon_hours INTEGER NOT NULL,
        predicted_value REAL NOT NULL, threshold_value REAL NOT NULL,
        predicted_breach INTEGER NOT NULL, predicted_breach_at TEXT,
        growth_per_hour REAL NOT NULL, alert TEXT, recommendation TEXT
      );
      CREATE TABLE IF NOT EXISTS sentinel_forecast_feedback (
        forecast_id TEXT PRIMARY KEY, actual_value REAL NOT NULL,
        actual_timestamp TEXT NOT NULL, actual_breached INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_forecast_rule ON sentinel_forecasts(rule_id);
    `);
    const engine = new SentinelForecastingEngine(
      path.resolve(filePath),
      database,
      options.executor,
      options.now ?? (() : Date => new Date())
    );
    await engine.persist();
    return engine;
  }

  /**
   * Forecasts a metric at 1, 4, and 24 hours and optionally triggers prevention.
   * @param rule Metric threshold and preventive action rule.
   * @param points Chronological time-series observations.
   * @returns Forecasts and proactive automation results.
   */
  async forecast(rule: ForecastRule, points: ForecastPoint[]): Promise<ForecastRun> {
    validateRule(rule);
    validatePoints(points);
    const generated = this.currentTime();
    const model = linearTrend(points);
    const forecasts = HORIZONS.map(horizon => buildForecast(rule, model, generated, horizon));
    forecasts.forEach(item => this.storeForecast(item));
    const actionResults: ForecastActionResult[] = [];
    const earliest = forecasts.find(item => item.predictedBreach);
    if (earliest && this.executor) {
      actionResults.push(await this.executor.execute(rule.proactiveAction, earliest));
    }
    await this.persist();
    return { forecasts, actionResults };
  }

  /**
   * Records the actual outcome for a prior prediction.
   * @param feedback Actual metric value and breach outcome.
   */
  async recordFeedback(feedback: ForecastFeedback): Promise<void> {
    required(feedback.forecastId, 'forecastId');
    finite(feedback.actualValue, 'actualValue');
    const timestamp = validDate(feedback.actualTimestamp, 'actualTimestamp');
    if (!this.getForecast(feedback.forecastId)) throw new Error(`Unknown forecast: ${feedback.forecastId}`);
    this.database.run(
      `INSERT INTO sentinel_forecast_feedback
       (forecast_id, actual_value, actual_timestamp, actual_breached)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(forecast_id) DO UPDATE SET
         actual_value=excluded.actual_value, actual_timestamp=excluded.actual_timestamp,
         actual_breached=excluded.actual_breached`,
      [
        feedback.forecastId,
        feedback.actualValue,
        new Date(timestamp).toISOString(),
        feedback.actualBreached ? 1 : 0
      ]
    );
    await this.persist();
  }

  /**
   * Calculates MAE, RMSE, false positives, and breach timing accuracy.
   * @param ruleId Optional rule filter.
   * @returns Current feedback metrics for model retraining decisions.
   */
  accuracy(ruleId?: string): ForecastAccuracy {
    const result = this.database.exec(
      `SELECT f.predicted_value, f.predicted_breach, f.predicted_breach_at,
              b.actual_value, b.actual_breached, b.actual_timestamp
       FROM sentinel_forecasts f JOIN sentinel_forecast_feedback b ON b.forecast_id = f.id
       ${ruleId ? 'WHERE f.rule_id = ?' : ''}`,
      ruleId ? [ruleId] : []
    );
    const rows = result[0]?.values ?? [];
    if (rows.length === 0) {
      return {
        sampleCount: 0,
        meanAbsoluteError: 0,
        rootMeanSquaredError: 0,
        falsePositiveRate: 0,
        averageDetectionLatencyMinutes: 0
      };
    }
    const errors = rows.map(row => Number(row[3]) - Number(row[0]));
    const predictedPositive = rows.filter(row => Number(row[1]) === 1);
    const falsePositives = predictedPositive.filter(row => Number(row[4]) === 0).length;
    const latencies = rows
      .filter(row => Number(row[1]) === 1 && Number(row[4]) === 1 && row[2] !== null)
      .map(row => (Date.parse(row[5] as string) - Date.parse(row[2] as string)) / 60_000);
    return {
      sampleCount: rows.length,
      meanAbsoluteError: round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / rows.length),
      rootMeanSquaredError: round(Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / rows.length)),
      falsePositiveRate: predictedPositive.length === 0
        ? 0
        : round(falsePositives / predictedPositive.length * 100),
      averageDetectionLatencyMinutes: latencies.length === 0
        ? 0
        : round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length)
    };
  }

  /**
   * Returns one persisted forecast.
   * @param forecastId Prediction identifier.
   * @returns Forecast or undefined.
   */
  getForecast(forecastId: string): MetricForecast | undefined {
    const result = this.database.exec(
      `SELECT id, rule_id, service, metric, generated_at, horizon_hours,
              predicted_value, threshold_value, predicted_breach,
              predicted_breach_at, growth_per_hour, alert, recommendation
       FROM sentinel_forecasts WHERE id = ?`,
      [forecastId]
    );
    const row = result[0]?.values[0];
    return row ? rowToForecast(row) : undefined;
  }

  private storeForecast(forecast: MetricForecast): void {
    this.database.run(
      `INSERT OR REPLACE INTO sentinel_forecasts
       (id, rule_id, service, metric, generated_at, horizon_hours,
        predicted_value, threshold_value, predicted_breach,
        predicted_breach_at, growth_per_hour, alert, recommendation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        forecast.id, forecast.ruleId, forecast.service, forecast.metric,
        forecast.generatedAt, forecast.horizonHours, forecast.predictedValue,
        forecast.threshold, forecast.predictedBreach ? 1 : 0,
        forecast.predictedBreachAt ?? null, forecast.growthPerHour,
        forecast.alert ?? null, forecast.recommendation ?? null
      ]
    );
  }

  private currentTime(): number {
    const timestamp = this.now().getTime();
    if (!Number.isFinite(timestamp)) throw new Error('Current time must be valid');
    return timestamp;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}

interface TrendModel {
  lastValue: number;
  lastTimestamp: number;
  growthPerHour: number;
}

/** Fits a least-squares trend over timestamped metric values. */
export function linearTrend(points: ForecastPoint[]): TrendModel {
  validatePoints(points);
  const origin = Date.parse(points[0]?.timestamp as string);
  const xs = points.map(point => (Date.parse(point.timestamp) - origin) / 3_600_000);
  const ys = points.map(point => point.value);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const denominator = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const growthPerHour = denominator === 0
    ? 0
    : xs.reduce((sum, value, index) => sum + (value - meanX) * ((ys[index] ?? 0) - meanY), 0) / denominator;
  const last = points.at(-1) as ForecastPoint;
  return {
    lastValue: last.value,
    lastTimestamp: Date.parse(last.timestamp),
    growthPerHour: round(growthPerHour)
  };
}

function buildForecast(
  rule: ForecastRule,
  model: TrendModel,
  generatedAt: number,
  horizonHours: ForecastHorizonHours
): MetricForecast {
  const predictedValue = round(model.lastValue + model.growthPerHour * horizonHours);
  const hoursToBreach = model.growthPerHour === 0
    ? undefined
    : (rule.threshold - model.lastValue) / model.growthPerHour;
  const movesTowardThreshold = rule.direction === 'above'
    ? model.growthPerHour > 0
    : model.growthPerHour < 0;
  const alreadyBreached = breached(model.lastValue, rule);
  const predictedBreach = alreadyBreached
    || (movesTowardThreshold && hoursToBreach !== undefined && hoursToBreach >= 0 && hoursToBreach <= horizonHours);
  const breachAt = alreadyBreached
    ? generatedAt
    : predictedBreach && hoursToBreach !== undefined
      ? model.lastTimestamp + hoursToBreach * 3_600_000
      : undefined;
  const generatedIso = new Date(generatedAt).toISOString();
  const id = `${rule.id}-${generatedAt}-${horizonHours}h`;
  return {
    id,
    ruleId: rule.id,
    service: rule.service,
    metric: rule.metric,
    generatedAt: generatedIso,
    horizonHours,
    predictedValue,
    threshold: rule.threshold,
    predictedBreach,
    ...(breachAt === undefined ? {} : { predictedBreachAt: new Date(breachAt).toISOString() }),
    growthPerHour: model.growthPerHour,
    ...(predictedBreach ? {
      alert: `${rule.metric} will breach ${rule.threshold} at ${new Date(breachAt as number).toISOString()} at current growth rate`,
      recommendation: rule.proactiveAction
    } : {})
  };
}

function breached(value: number, rule: ForecastRule): boolean {
  return rule.direction === 'above' ? value >= rule.threshold : value <= rule.threshold;
}

function rowToForecast(row: Array<number | string | Uint8Array | null>): MetricForecast {
  return {
    id: row[0] as string,
    ruleId: row[1] as string,
    service: row[2] as string,
    metric: row[3] as string,
    generatedAt: row[4] as string,
    horizonHours: Number(row[5]) as ForecastHorizonHours,
    predictedValue: Number(row[6]),
    threshold: Number(row[7]),
    predictedBreach: Number(row[8]) === 1,
    ...(row[9] === null ? {} : { predictedBreachAt: row[9] as string }),
    growthPerHour: Number(row[10]),
    ...(row[11] === null ? {} : { alert: row[11] as string }),
    ...(row[12] === null ? {} : { recommendation: row[12] as string })
  };
}

function validateRule(rule: ForecastRule): void {
  required(rule.id, 'rule.id');
  required(rule.service, 'rule.service');
  required(rule.metric, 'rule.metric');
  required(rule.proactiveAction, 'rule.proactiveAction');
  finite(rule.threshold, 'rule.threshold');
  if (!['above', 'below'].includes(rule.direction)) throw new Error('rule.direction must be above or below');
}

function validatePoints(points: ForecastPoint[]): void {
  if (points.length < 3) throw new Error('At least three forecast points are required');
  let previous = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const timestamp = validDate(point.timestamp, 'point.timestamp');
    finite(point.value, 'point.value');
    if (timestamp <= previous) throw new Error('Forecast points must be strictly chronological');
    previous = timestamp;
  }
}

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function validDate(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid timestamp`);
  return timestamp;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
