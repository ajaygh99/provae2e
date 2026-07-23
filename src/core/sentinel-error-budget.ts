/** Sentinel SLA/error-budget tracking, projections, compliance, and deployment gates. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export type SlaTarget = 99 | 99.5 | 99.9 | 99.99;

export interface ServiceSlaConfig {
  service: string;
  target: SlaTarget;
  budgetWindow: 'month';
}

export interface DowntimeEvent {
  id: string;
  service: string;
  start: string;
  end: string;
  cause: string;
}

export interface ErrorBudgetAlert {
  service: string;
  threshold: 50 | 75 | 90;
  consumedPercent: number;
  message: string;
}

export interface ErrorBudgetStatus {
  service: string;
  target: SlaTarget;
  periodFrom: string;
  periodTo: string;
  budgetMs: number;
  downtimeMs: number;
  remainingMs: number;
  consumedPercent: number;
  actualUptimePercent: number;
  compliant: boolean;
  projection: string;
  projectedExhaustionDate?: string;
  alerts: ErrorBudgetAlert[];
  deploymentAllowed: boolean;
  deploymentDecision: string;
}

export interface ErrorBudgetComplianceReport {
  generatedAt: string;
  month: string;
  compliantServices: number;
  nonCompliantServices: number;
  services: ErrorBudgetStatus[];
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed monthly SLA and error-budget tracker. */
export class SentinelErrorBudgetTracker {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly configs: ServiceSlaConfig[],
    private readonly now: () => Date
  ) {}

  /**
   * Opens an error-budget tracker.
   * @param filePath SQLite database path.
   * @param configs Per-service monthly SLA configuration.
   * @param now Injectable clock.
   * @returns Initialized tracker.
   */
  static async open(
    filePath: string,
    configs: ServiceSlaConfig[],
    now: () => Date = () => new Date()
  ): Promise<SentinelErrorBudgetTracker> {
    validateConfigs(configs);
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS sentinel_downtime (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL, service TEXT NOT NULL, start TEXT NOT NULL,
        end TEXT NOT NULL, duration_ms INTEGER NOT NULL, cause TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_downtime_service_start ON sentinel_downtime(service, start);
    `);
    const tracker = new SentinelErrorBudgetTracker(path.resolve(filePath), database, configs, now);
    await tracker.persist();
    return tracker;
  }

  /**
   * Appends one immutable downtime event.
   * @param event Downtime interval and cause.
   * @returns True when inserted, false for an exact duplicate id.
   */
  async recordDowntime(event: DowntimeEvent): Promise<boolean> {
    validateDowntime(event, this.configs);
    const start = Date.parse(event.start);
    const end = Date.parse(event.end);
    this.database.run(
      `INSERT OR IGNORE INTO sentinel_downtime
       (id, service, start, end, duration_ms, cause) VALUES (?, ?, ?, ?, ?, ?)`,
      [event.id, event.service, new Date(start).toISOString(), new Date(end).toISOString(), end - start, event.cause]
    );
    const inserted = this.database.getRowsModified() === 1;
    await this.persist();
    return inserted;
  }

  /**
   * Calculates one service's monthly SLA status and deployment decision.
   * @param service Configured service.
   * @param month YYYY-MM.
   * @returns Error-budget status.
   */
  status(service: string, month: string): ErrorBudgetStatus {
    const config = this.configs.find(item => item.service === service);
    if (!config) throw new Error(`Unknown SLA service: ${service}`);
    const { from, to } = monthWindow(month);
    const windowMs = to - from;
    const budgetMs = windowMs * (100 - config.target) / 100;
    const downtimeMs = this.downtime(service, from, to);
    const consumedPercent = budgetMs === 0 ? 100 : round(downtimeMs / budgetMs * 100);
    const remainingMs = Math.max(0, budgetMs - downtimeMs);
    const actualUptimePercent = round((1 - downtimeMs / windowMs) * 100, 4);
    const alerts = thresholds(consumedPercent).map(threshold => ({
      service,
      threshold,
      consumedPercent,
      message: `${service} has consumed ${consumedPercent}% of its ${config.target}% SLA error budget`
    }));
    const projection = projectExhaustion(downtimeMs, budgetMs, from, to, this.currentTime());
    const deploymentAllowed = consumedPercent < 90;
    return {
      service,
      target: config.target,
      periodFrom: new Date(from).toISOString(),
      periodTo: new Date(to).toISOString(),
      budgetMs: round(budgetMs),
      downtimeMs,
      remainingMs: round(remainingMs),
      consumedPercent,
      actualUptimePercent,
      compliant: downtimeMs <= budgetMs,
      projection: projection.message,
      ...(projection.date ? { projectedExhaustionDate: projection.date } : {}),
      alerts,
      deploymentAllowed,
      deploymentDecision: deploymentAllowed
        ? 'Deployment allowed within remaining error budget'
        : 'Deployment blocked: error budget is at or above 90% consumed'
    };
  }

  /**
   * Generates monthly SOC 2 / annual-review compatible evidence.
   * @param month YYYY-MM.
   * @returns Service compliance report.
   */
  complianceReport(month: string): ErrorBudgetComplianceReport {
    const services = this.configs.map(config => this.status(config.service, month));
    const compliantServices = services.filter(service => service.compliant).length;
    return {
      generatedAt: new Date(this.currentTime()).toISOString(),
      month,
      compliantServices,
      nonCompliantServices: services.length - compliantServices,
      services
    };
  }

  private downtime(service: string, from: number, to: number): number {
    const result = this.database.exec(
      `SELECT start, end FROM sentinel_downtime
       WHERE service = ? AND end > ? AND start < ?`,
      [service, new Date(from).toISOString(), new Date(to).toISOString()]
    );
    return result[0]?.values.reduce((total, row) => {
      const start = Math.max(from, Date.parse(row[0] as string));
      const end = Math.min(to, Date.parse(row[1] as string));
      return total + Math.max(0, end - start);
    }, 0) ?? 0;
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

/** Parses services[].sla YAML configuration. */
export function parseSlaConfig(content: string): ServiceSlaConfig[] {
  let document: unknown;
  try { document = parseYaml(content); } catch { throw new Error('Invalid SLA YAML'); }
  const services = (document as { services?: Array<{ name?: unknown; sla?: { target?: unknown; budget_window?: unknown } }> })?.services;
  if (!Array.isArray(services)) throw new Error('SLA YAML requires services[]');
  const configs = services.map(item => ({
    service: String(item.name ?? ''),
    target: Number(item.sla?.target) as SlaTarget,
    budgetWindow: String(item.sla?.budget_window ?? '') as 'month'
  }));
  validateConfigs(configs);
  return configs;
}

/** Returns allowed monthly downtime for an SLA target and exact month. */
export function monthlyBudgetMs(target: SlaTarget, month: string): number {
  validateTarget(target);
  const { from, to } = monthWindow(month);
  return round((to - from) * (100 - target) / 100);
}

function projectExhaustion(
  downtimeMs: number,
  budgetMs: number,
  from: number,
  to: number,
  now: number
): { message: string; date?: string } {
  if (downtimeMs <= 0) return { message: 'No downtime recorded; budget exhaustion is not projected' };
  if (downtimeMs >= budgetMs) return { message: 'Error budget exhausted', date: new Date(Math.min(Math.max(now, from), to)).toISOString() };
  const elapsed = Math.max(1, Math.min(now, to) - from);
  const rate = downtimeMs / elapsed;
  const exhaustionTime = from + budgetMs / rate;
  if (exhaustionTime > to) return { message: 'Budget is projected to remain available through month end' };
  const days = Math.max(0, Math.ceil((exhaustionTime - now) / 86_400_000));
  return {
    message: `At current rate, budget will be exhausted in ${days} days`,
    date: new Date(exhaustionTime).toISOString()
  };
}

function thresholds(consumed: number): Array<50 | 75 | 90> {
  const result: Array<50 | 75 | 90> = [];
  if (consumed >= 50) result.push(50);
  if (consumed >= 75) result.push(75);
  if (consumed >= 90) result.push(90);
  return result;
}

function validateConfigs(configs: ServiceSlaConfig[]): void {
  if (!configs.length) throw new Error('At least one SLA service is required');
  const names = new Set<string>();
  for (const config of configs) {
    if (!config.service.trim()) throw new Error('SLA service name is required');
    if (names.has(config.service)) throw new Error(`Duplicate SLA service: ${config.service}`);
    names.add(config.service);
    validateTarget(config.target);
    if (config.budgetWindow !== 'month') throw new Error('budgetWindow must be month');
  }
}

function validateTarget(target: number): asserts target is SlaTarget {
  if (![99, 99.5, 99.9, 99.99].includes(target)) throw new Error('SLA target must be 99, 99.5, 99.9, or 99.99');
}

function validateDowntime(event: DowntimeEvent, configs: ServiceSlaConfig[]): void {
  if (!event.id.trim()) throw new Error('Downtime id is required');
  if (!configs.some(config => config.service === event.service)) throw new Error(`Unknown SLA service: ${event.service}`);
  if (!event.cause.trim()) throw new Error('Downtime cause is required');
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Downtime timestamps must be valid');
  if (end <= start) throw new Error('Downtime end must be after start');
}

function monthWindow(month: string): { from: number; to: number } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month must use YYYY-MM');
  const [year, monthNumber] = month.split('-').map(Number);
  return { from: Date.UTC(year, monthNumber - 1, 1), to: Date.UTC(year, monthNumber, 1) };
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}
