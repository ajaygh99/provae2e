/** Multi-cloud cost analysis, optimization recommendations, and trends. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type CloudProvider = 'aws' | 'gcp' | 'azure';
export type ResourceKind = 'compute' | 'storage' | 'database' | 'network' | 'other';

export interface CloudCostRecord {
  id: string;
  provider: CloudProvider;
  service: string;
  resourceId: string;
  resourceKind: ResourceKind;
  month: string;
  cost: number;
  cpuPercent: number;
  memoryPercent: number;
  dataTransferGb: number;
  storageUsedPercent?: number;
  tags?: Record<string, string>;
}

export interface CloudCostCollector {
  provider: CloudProvider;
  collect(month: string): Promise<CloudCostRecord[]>;
}

export type CostOpportunity = 'idle-resource' | 'low-utilization' | 'unused-storage';

export interface CostRecommendation {
  service: string;
  provider: CloudProvider;
  resourceId: string;
  opportunity: CostOpportunity;
  currentMonthlyCost: number;
  recommendedMonthlyCost: number;
  monthlySavings: number;
  annualSavings: number;
  savingsPercent: number;
  autoSurfaced: boolean;
  recommendation: string;
}

export interface ServiceCostTrend {
  service: string;
  currentCost: number;
  previousCost: number;
  changeAmount: number;
  changePercent: number;
  unexpectedIncrease: boolean;
}

export interface MonthlyCostReport {
  month: string;
  generatedAt: string;
  totalCost: number;
  costByProvider: Record<CloudProvider, number>;
  costByService: Record<string, number>;
  recommendations: CostRecommendation[];
  projectedMonthlySavings: number;
  projectedAnnualSavings: number;
  projectedSavingsPercent: number;
  trends: ServiceCostTrend[];
  alerts: string[];
}

export interface CostOptimizerOptions {
  autoSurfaceMonthlySavings?: number;
  unexpectedIncreasePercent?: number;
  now?: () => Date;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed multi-cloud cost optimization engine. */
export class SentinelCostOptimizer {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly autoSurfaceMonthlySavings: number,
    private readonly unexpectedIncreasePercent: number,
    private readonly now: () => Date
  ) {}

  /**
   * Opens or creates a cost history store.
   * @param filePath SQLite database location.
   * @param options Alert thresholds and clock.
   * @returns Initialized optimizer.
   */
  static async open(
    filePath: string,
    options: CostOptimizerOptions = {}
  ): Promise<SentinelCostOptimizer> {
    const autoSurface = options.autoSurfaceMonthlySavings ?? 500;
    const increase = options.unexpectedIncreasePercent ?? 20;
    positiveOrZero(autoSurface, 'autoSurfaceMonthlySavings');
    positiveOrZero(increase, 'unexpectedIncreasePercent');
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS sentinel_cloud_costs (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        provider TEXT NOT NULL, service TEXT NOT NULL, resource_id TEXT NOT NULL,
        resource_kind TEXT NOT NULL, month TEXT NOT NULL, cost REAL NOT NULL,
        cpu_percent REAL NOT NULL, memory_percent REAL NOT NULL,
        data_transfer_gb REAL NOT NULL, storage_used_percent REAL, tags TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cloud_cost_month ON sentinel_cloud_costs(month);
      CREATE INDEX IF NOT EXISTS idx_cloud_cost_service ON sentinel_cloud_costs(service, month);
    `);
    const optimizer = new SentinelCostOptimizer(
      path.resolve(filePath),
      database,
      autoSurface,
      increase,
      options.now ?? (() : Date => new Date())
    );
    await optimizer.persist();
    return optimizer;
  }

  /**
   * Collects and stores one provider's normalized monthly billing data.
   * @param collector AWS Cost Explorer, GCP Billing, or Azure Cost adapter.
   * @param month Month formatted YYYY-MM.
   * @returns Number of newly stored records.
   */
  async collect(collector: CloudCostCollector, month: string): Promise<number> {
    validateMonth(month);
    if (!['aws', 'gcp', 'azure'].includes(collector.provider)) {
      throw new Error(`Unsupported cloud provider: ${String(collector.provider)}`);
    }
    const records = await collector.collect(month);
    let inserted = 0;
    for (const record of records) {
      if (record.provider !== collector.provider) {
        throw new Error(`Collector provider mismatch for record ${record.id}`);
      }
      if (record.month !== month) throw new Error(`Collector month mismatch for record ${record.id}`);
      inserted += this.store(record) ? 1 : 0;
    }
    await this.persist();
    return inserted;
  }

  /**
   * Stores one normalized cost and utilization record.
   * @param record Cloud billing resource record.
   * @returns True when inserted, false when the id already exists.
   */
  async record(record: CloudCostRecord): Promise<boolean> {
    const inserted = this.store(record);
    await this.persist();
    return inserted;
  }

  /**
   * Produces a monthly cost breakdown, trends, alerts, and opportunities.
   * @param month Month formatted YYYY-MM.
   * @returns Monthly optimization report.
   */
  monthlyReport(month: string): MonthlyCostReport {
    validateMonth(month);
    const records = this.records(month);
    const previous = this.records(previousMonth(month));
    const recommendations = records
      .map(record => recommendation(record, this.autoSurfaceMonthlySavings))
      .filter((item): item is CostRecommendation => item !== undefined)
      .sort((left, right) => right.monthlySavings - left.monthlySavings);
    const totalCost = sum(records.map(record => record.cost));
    const projectedMonthlySavings = sum(recommendations.map(item => item.monthlySavings));
    const trends = costTrends(records, previous, this.unexpectedIncreasePercent);
    return {
      month,
      generatedAt: new Date(this.currentTime()).toISOString(),
      totalCost,
      costByProvider: providerBreakdown(records),
      costByService: serviceBreakdown(records),
      recommendations,
      projectedMonthlySavings,
      projectedAnnualSavings: round(projectedMonthlySavings * 12),
      projectedSavingsPercent: totalCost === 0 ? 0 : round(projectedMonthlySavings / totalCost * 100),
      trends,
      alerts: trends
        .filter(trend => trend.unexpectedIncrease)
        .map(trend => `${trend.service} cost increased ${trend.changePercent}% to $${formatMoney(trend.currentCost)}`)
    };
  }

  private store(record: CloudCostRecord): boolean {
    validateRecord(record);
    this.database.run(
      `INSERT OR IGNORE INTO sentinel_cloud_costs
       (id, provider, service, resource_id, resource_kind, month, cost,
        cpu_percent, memory_percent, data_transfer_gb, storage_used_percent, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id, record.provider, record.service, record.resourceId,
        record.resourceKind, record.month, record.cost, record.cpuPercent,
        record.memoryPercent, record.dataTransferGb,
        record.storageUsedPercent ?? null, JSON.stringify(record.tags ?? {})
      ]
    );
    return this.database.getRowsModified() === 1;
  }

  private records(month: string): CloudCostRecord[] {
    const result = this.database.exec(
      `SELECT id, provider, service, resource_id, resource_kind, month, cost,
              cpu_percent, memory_percent, data_transfer_gb, storage_used_percent, tags
       FROM sentinel_cloud_costs WHERE month = ? ORDER BY sequence`,
      [month]
    );
    return result[0]?.values.map(row => ({
      id: row[0] as string,
      provider: row[1] as CloudProvider,
      service: row[2] as string,
      resourceId: row[3] as string,
      resourceKind: row[4] as ResourceKind,
      month: row[5] as string,
      cost: Number(row[6]),
      cpuPercent: Number(row[7]),
      memoryPercent: Number(row[8]),
      dataTransferGb: Number(row[9]),
      ...(row[10] === null ? {} : { storageUsedPercent: Number(row[10]) }),
      tags: JSON.parse(row[11] as string) as Record<string, string>
    })) ?? [];
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

/** Returns an optimization recommendation when utilization is wasteful. */
export function recommendation(
  record: CloudCostRecord,
  autoSurfaceMonthlySavings = 500
): CostRecommendation | undefined {
  validateRecord(record);
  positiveOrZero(autoSurfaceMonthlySavings, 'autoSurfaceMonthlySavings');
  let opportunity: CostOpportunity | undefined;
  let savingsRate = 0;
  let action = '';
  if (record.resourceKind === 'storage' && (record.storageUsedPercent ?? 100) === 0) {
    opportunity = 'unused-storage';
    savingsRate = 1;
    action = 'delete unused storage after retention review';
  } else if (record.cpuPercent < 1 && record.memoryPercent < 5 && record.dataTransferGb < 1) {
    opportunity = 'idle-resource';
    savingsRate = 0.8;
    action = 'turn off after 10 PM or schedule on demand';
  } else if (record.cpuPercent < 10 && record.memoryPercent < 20 && record.dataTransferGb < 100) {
    opportunity = 'low-utilization';
    savingsRate = 0.3;
    action = 'right-size to a cheaper instance';
  }
  if (!opportunity) return undefined;
  const monthlySavings = round(record.cost * savingsRate);
  const recommendedMonthlyCost = round(record.cost - monthlySavings);
  const savingsPercent = round(monthlySavings / record.cost * 100);
  return {
    service: record.service,
    provider: record.provider,
    resourceId: record.resourceId,
    opportunity,
    currentMonthlyCost: round(record.cost),
    recommendedMonthlyCost,
    monthlySavings,
    annualSavings: round(monthlySavings * 12),
    savingsPercent,
    autoSurfaced: monthlySavings > autoSurfaceMonthlySavings,
    recommendation: `${record.service} ${opportunity === 'idle-resource' ? 'is idle over 95% of time' : 'is underutilized'}; ${action} (save $${formatMoney(monthlySavings)}/month, ${savingsPercent}%)`
  };
}

function costTrends(
  current: CloudCostRecord[],
  previous: CloudCostRecord[],
  alertPercent: number
): ServiceCostTrend[] {
  const currentCosts = serviceBreakdown(current);
  const previousCosts = serviceBreakdown(previous);
  return Object.keys(currentCosts).sort().map(service => {
    const currentCost = currentCosts[service] ?? 0;
    const previousCost = previousCosts[service] ?? 0;
    const changeAmount = round(currentCost - previousCost);
    const changePercent = previousCost === 0
      ? (currentCost > 0 ? 100 : 0)
      : round(changeAmount / previousCost * 100);
    return {
      service,
      currentCost,
      previousCost,
      changeAmount,
      changePercent,
      unexpectedIncrease: previousCost > 0 && changePercent >= alertPercent
    };
  });
}

function providerBreakdown(records: CloudCostRecord[]): Record<CloudProvider, number> {
  const result: Record<CloudProvider, number> = { aws: 0, gcp: 0, azure: 0 };
  records.forEach(record => { result[record.provider] = round(result[record.provider] + record.cost); });
  return result;
}

function serviceBreakdown(records: CloudCostRecord[]): Record<string, number> {
  const result: Record<string, number> = {};
  records.forEach(record => { result[record.service] = round((result[record.service] ?? 0) + record.cost); });
  return result;
}

function validateRecord(record: CloudCostRecord): void {
  required(record.id, 'id');
  required(record.service, 'service');
  required(record.resourceId, 'resourceId');
  if (!['aws', 'gcp', 'azure'].includes(record.provider)) throw new Error('provider must be aws, gcp, or azure');
  if (!['compute', 'storage', 'database', 'network', 'other'].includes(record.resourceKind)) {
    throw new Error('Invalid resourceKind');
  }
  validateMonth(record.month);
  positive(record.cost, 'cost');
  percentage(record.cpuPercent, 'cpuPercent');
  percentage(record.memoryPercent, 'memoryPercent');
  positiveOrZero(record.dataTransferGb, 'dataTransferGb');
  if (record.storageUsedPercent !== undefined) percentage(record.storageUsedPercent, 'storageUsedPercent');
}

function validateMonth(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month must use YYYY-MM');
}

function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function positiveOrZero(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
}

function percentage(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${name} must be between 0 and 100`);
}

function sum(values: number[]): number {
  return round(values.reduce((total, value) => total + value, 0));
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function formatMoney(value: number): string {
  return round(value).toLocaleString('en-US');
}
