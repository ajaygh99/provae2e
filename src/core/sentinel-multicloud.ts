/** Unified Sentinel monitoring for cloud and hybrid environments. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type InfrastructureCloud = 'aws' | 'gcp' | 'azure' | 'on-prem';
export type ComplianceFramework = 'GDPR' | 'HIPAA' | 'SOC2' | 'PCI-DSS';

export interface CloudMetric {
  id: string;
  cloud: InfrastructureCloud;
  region: string;
  service: string;
  timestamp: string;
  latencyMs: number;
  errorRate: number;
  throughput: number;
  monthlyCost: number;
}

export interface CloudConnector {
  cloud: InfrastructureCloud;
  collect(): Promise<CloudMetric[]>;
}

export interface CloudScenarioCoverage {
  scenario: string;
  service: string;
  clouds: InfrastructureCloud[];
}

export interface CloudIncident {
  id: string;
  cloud: InfrastructureCloud;
  service: string;
  signature: string;
  timestamp: string;
}

export interface CloudCompliance {
  cloud: InfrastructureCloud;
  region: string;
  frameworks: ComplianceFramework[];
}

export interface CrossCloudFinding {
  signature: string;
  service: string;
  affectedClouds: InfrastructureCloud[];
  untestedClouds: InfrastructureCloud[];
  recommendation: string;
}

export interface CloudDashboard {
  generatedAt: string;
  metrics: CloudMetric[];
  averageByCloud: Record<InfrastructureCloud, {
    latencyMs: number;
    errorRate: number;
    throughput: number;
    monthlyCost: number;
  }>;
  coverage: CloudScenarioCoverage[];
  costByCloud: Record<InfrastructureCloud, number>;
  compliance: CloudCompliance[];
  crossCloudFindings: CrossCloudFinding[];
}

const CLOUDS: InfrastructureCloud[] = ['aws', 'gcp', 'azure', 'on-prem'];
let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed unified cloud and hybrid monitoring store. */
export class SentinelMultiCloudMonitor {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly now: () => Date
  ) {}

  /** Opens a cloud-agnostic monitoring store. */
  static async open(filePath: string, now: () => Date = () => new Date()): Promise<SentinelMultiCloudMonitor> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS multicloud_metrics (
        id TEXT PRIMARY KEY, cloud TEXT NOT NULL, region TEXT NOT NULL,
        service TEXT NOT NULL, timestamp TEXT NOT NULL, latency_ms REAL NOT NULL,
        error_rate REAL NOT NULL, throughput REAL NOT NULL, monthly_cost REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS multicloud_coverage (
        scenario TEXT NOT NULL, service TEXT NOT NULL, cloud TEXT NOT NULL,
        PRIMARY KEY(scenario, service, cloud)
      );
      CREATE TABLE IF NOT EXISTS multicloud_incidents (
        id TEXT PRIMARY KEY, cloud TEXT NOT NULL, service TEXT NOT NULL,
        signature TEXT NOT NULL, timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS multicloud_compliance (
        cloud TEXT NOT NULL, region TEXT NOT NULL, framework TEXT NOT NULL,
        PRIMARY KEY(cloud, region, framework)
      );
    `);
    const monitor = new SentinelMultiCloudMonitor(path.resolve(filePath), database, now);
    await monitor.persist();
    return monitor;
  }

  /** Collects normalized metrics from an AWS, GCP, Azure, or Prometheus adapter. */
  async collect(connector: CloudConnector): Promise<number> {
    validateCloud(connector.cloud);
    const metrics = await connector.collect();
    let inserted = 0;
    for (const metric of metrics) {
      if (metric.cloud !== connector.cloud) throw new Error(`Connector cloud mismatch for ${metric.id}`);
      inserted += this.storeMetric(metric) ? 1 : 0;
    }
    await this.persist();
    return inserted;
  }

  /** Records a normalized metric. */
  async recordMetric(metric: CloudMetric): Promise<boolean> {
    const inserted = this.storeMetric(metric);
    await this.persist();
    return inserted;
  }

  /** Links a test scenario to every cloud where it executes. */
  async recordCoverage(coverage: CloudScenarioCoverage): Promise<void> {
    required(coverage.scenario, 'scenario');
    required(coverage.service, 'service');
    if (coverage.clouds.length === 0) throw new Error('coverage.clouds is required');
    for (const cloud of [...new Set(coverage.clouds)]) {
      validateCloud(cloud);
      this.database.run(
        'INSERT OR IGNORE INTO multicloud_coverage (scenario, service, cloud) VALUES (?, ?, ?)',
        [coverage.scenario, coverage.service, cloud]
      );
    }
    await this.persist();
  }

  /** Records an incident signature for cross-cloud recurrence analysis. */
  async recordIncident(incident: CloudIncident): Promise<boolean> {
    validateIncident(incident);
    this.database.run(
      `INSERT OR IGNORE INTO multicloud_incidents
       (id, cloud, service, signature, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [incident.id, incident.cloud, incident.service, incident.signature, new Date(Date.parse(incident.timestamp)).toISOString()]
    );
    const inserted = this.database.getRowsModified() === 1;
    await this.persist();
    return inserted;
  }

  /** Registers compliance requirements by cloud and region. */
  async recordCompliance(value: CloudCompliance): Promise<void> {
    validateCloud(value.cloud);
    required(value.region, 'region');
    if (value.frameworks.length === 0) throw new Error('frameworks is required');
    for (const framework of [...new Set(value.frameworks)]) {
      if (!['GDPR', 'HIPAA', 'SOC2', 'PCI-DSS'].includes(framework)) throw new Error(`Invalid framework: ${framework}`);
      this.database.run(
        'INSERT OR IGNORE INTO multicloud_compliance (cloud, region, framework) VALUES (?, ?, ?)',
        [value.cloud, value.region, framework]
      );
    }
    await this.persist();
  }

  /** Produces a unified dashboard with cloud drill-down data. */
  dashboard(cloud?: InfrastructureCloud): CloudDashboard {
    if (cloud) validateCloud(cloud);
    const metrics = this.metrics(cloud);
    const coverage = this.coverage(cloud);
    const compliance = this.compliance(cloud);
    const averageByCloud = emptyAverages();
    for (const candidate of CLOUDS) {
      const matching = metrics.filter(metric => metric.cloud === candidate);
      if (matching.length > 0) {
        averageByCloud[candidate] = {
          latencyMs: average(matching.map(metric => metric.latencyMs)),
          errorRate: average(matching.map(metric => metric.errorRate)),
          throughput: average(matching.map(metric => metric.throughput)),
          monthlyCost: sum(matching.map(metric => metric.monthlyCost))
        };
      }
    }
    return {
      generatedAt: new Date(this.currentTime()).toISOString(),
      metrics,
      averageByCloud,
      coverage,
      costByCloud: Object.fromEntries(CLOUDS.map(candidate => [
        candidate,
        sum(metrics.filter(metric => metric.cloud === candidate).map(metric => metric.monthlyCost))
      ])) as Record<InfrastructureCloud, number>,
      compliance,
      crossCloudFindings: this.crossCloudFindings()
        .filter(finding => !cloud || finding.affectedClouds.includes(cloud))
    };
  }

  /** Detects recurring incident signatures and cloud coverage gaps. */
  crossCloudFindings(): CrossCloudFinding[] {
    const result = this.database.exec(
      `SELECT signature, service, GROUP_CONCAT(DISTINCT cloud)
       FROM multicloud_incidents GROUP BY signature, service`
    );
    return (result[0]?.values ?? []).map(row => {
      const signature = row[0] as string;
      const service = row[1] as string;
      const affectedClouds = String(row[2]).split(',') as InfrastructureCloud[];
      const tested = new Set(this.coverage().filter(item => item.service === service).flatMap(item => item.clouds));
      const untestedClouds = CLOUDS.filter(cloud => !tested.has(cloud));
      const source = affectedClouds[0] as InfrastructureCloud;
      const target = untestedClouds[0];
      return {
        signature,
        service,
        affectedClouds,
        untestedClouds,
        recommendation: target
          ? `This failure in ${source.toUpperCase()} may also affect ${target.toUpperCase()}, recommend testing ${signature} on ${target.toUpperCase()}`
          : `Cross-cloud coverage exists for ${signature}`
      };
    });
  }

  private storeMetric(metric: CloudMetric): boolean {
    validateMetric(metric);
    this.database.run(
      `INSERT OR IGNORE INTO multicloud_metrics
       (id, cloud, region, service, timestamp, latency_ms, error_rate, throughput, monthly_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metric.id, metric.cloud, metric.region, metric.service,
        new Date(Date.parse(metric.timestamp)).toISOString(), metric.latencyMs,
        metric.errorRate, metric.throughput, metric.monthlyCost
      ]
    );
    return this.database.getRowsModified() === 1;
  }

  private metrics(cloud?: InfrastructureCloud): CloudMetric[] {
    const result = this.database.exec(
      `SELECT id, cloud, region, service, timestamp, latency_ms, error_rate,
              throughput, monthly_cost FROM multicloud_metrics
       ${cloud ? 'WHERE cloud = ?' : ''} ORDER BY timestamp`,
      cloud ? [cloud] : []
    );
    return (result[0]?.values ?? []).map(row => ({
      id: row[0] as string,
      cloud: row[1] as InfrastructureCloud,
      region: row[2] as string,
      service: row[3] as string,
      timestamp: row[4] as string,
      latencyMs: Number(row[5]),
      errorRate: Number(row[6]),
      throughput: Number(row[7]),
      monthlyCost: Number(row[8])
    }));
  }

  private coverage(cloud?: InfrastructureCloud): CloudScenarioCoverage[] {
    const result = this.database.exec(
      `SELECT scenario, service, GROUP_CONCAT(cloud) FROM multicloud_coverage
       ${cloud ? 'WHERE cloud = ?' : ''} GROUP BY scenario, service`,
      cloud ? [cloud] : []
    );
    return (result[0]?.values ?? []).map(row => ({
      scenario: row[0] as string,
      service: row[1] as string,
      clouds: String(row[2]).split(',') as InfrastructureCloud[]
    }));
  }

  private compliance(cloud?: InfrastructureCloud): CloudCompliance[] {
    const result = this.database.exec(
      `SELECT cloud, region, GROUP_CONCAT(framework) FROM multicloud_compliance
       ${cloud ? 'WHERE cloud = ?' : ''} GROUP BY cloud, region`,
      cloud ? [cloud] : []
    );
    return (result[0]?.values ?? []).map(row => ({
      cloud: row[0] as InfrastructureCloud,
      region: row[1] as string,
      frameworks: String(row[2]).split(',') as ComplianceFramework[]
    }));
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

function emptyAverages(): CloudDashboard['averageByCloud'] {
  const empty = { latencyMs: 0, errorRate: 0, throughput: 0, monthlyCost: 0 };
  return { aws: { ...empty }, gcp: { ...empty }, azure: { ...empty }, 'on-prem': { ...empty } };
}

function validateMetric(metric: CloudMetric): void {
  required(metric.id, 'id');
  validateCloud(metric.cloud);
  required(metric.region, 'region');
  required(metric.service, 'service');
  validDate(metric.timestamp, 'timestamp');
  nonNegative(metric.latencyMs, 'latencyMs');
  percentage(metric.errorRate, 'errorRate');
  nonNegative(metric.throughput, 'throughput');
  nonNegative(metric.monthlyCost, 'monthlyCost');
}

function validateIncident(incident: CloudIncident): void {
  required(incident.id, 'id');
  validateCloud(incident.cloud);
  required(incident.service, 'service');
  required(incident.signature, 'signature');
  validDate(incident.timestamp, 'timestamp');
}

function validateCloud(cloud: InfrastructureCloud): void {
  if (!CLOUDS.includes(cloud)) throw new Error(`Unsupported cloud: ${String(cloud)}`);
}

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function validDate(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be valid`);
  return timestamp;
}

function nonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
}

function percentage(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${name} must be between 0 and 100`);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : round(values.reduce((total, value) => total + value, 0) / values.length);
}

function sum(values: number[]): number {
  return round(values.reduce((total, value) => total + value, 0));
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
