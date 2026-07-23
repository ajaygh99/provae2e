/** Sentinel software-composition analysis and CVE compliance monitoring. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type DependencyEcosystem = 'npm' | 'pip' | 'maven';
export type CveSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export interface ProductionDependency {
  service: string;
  ecosystem: DependencyEcosystem;
  name: string;
  version: string;
  testIds: string[];
}

export interface CveMatch {
  cveId: string;
  packageName: string;
  ecosystem: DependencyEcosystem;
  affectedVersions: string;
  cvssScore: number;
  description: string;
  fixedVersion?: string;
  publishedAt: string;
}

export type CveProvider = (dependency: ProductionDependency) => Promise<CveMatch[]>;

export interface DependencyAlert {
  cveId: string;
  severity: CveSeverity;
  service: string;
  dependency: string;
  currentVersion: string;
  testCoverage: string[];
  action: string;
  channel: 'slack' | 'email';
}

export type DependencyNotifier = (alert: DependencyAlert) => Promise<void>;

export interface DependencyPollResult {
  dependenciesChecked: number;
  cvesFound: number;
  alertsSent: number;
  alertFailures: number;
  findings: DependencyFinding[];
}

export interface DependencyFinding extends DependencyAlert {
  cvssScore: number;
  description: string;
  publishedAt: string;
  status: 'open' | 'patched';
  detectedAt: string;
  patchedAt?: string;
}

export interface Soc2CveReport {
  generatedAt: string;
  periodFrom: string;
  periodTo: string;
  monitoredDependencies: number;
  findings: number;
  open: number;
  patched: number;
  critical: number;
  high: number;
  medium: number;
  patchCompliancePercent: number;
  evidence: DependencyFinding[];
}

export interface DependencyMonitorOptions {
  provider: CveProvider;
  notifier?: DependencyNotifier;
  alertChannel?: 'slack' | 'email';
  now?: () => Date;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed daily dependency and vulnerability monitor. */
export class SentinelDependencyMonitor {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly options: DependencyMonitorOptions
  ) {}

  /**
   * Opens a dependency monitoring store.
   * @param filePath SQLite database path.
   * @param options CVE provider and notification integrations.
   * @returns Initialized monitor.
   */
  static async open(filePath: string, options: DependencyMonitorOptions): Promise<SentinelDependencyMonitor> {
    if (typeof options.provider !== 'function') throw new Error('provider is required');
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS dependency_snapshots (
        service TEXT NOT NULL, ecosystem TEXT NOT NULL, name TEXT NOT NULL,
        version TEXT NOT NULL, test_ids TEXT NOT NULL, captured_at TEXT NOT NULL,
        UNIQUE(service, ecosystem, name, version)
      );
      CREATE TABLE IF NOT EXISTS cve_findings (
        cve_id TEXT NOT NULL, service TEXT NOT NULL, ecosystem TEXT NOT NULL,
        dependency TEXT NOT NULL, current_version TEXT NOT NULL, cvss_score REAL NOT NULL,
        severity TEXT NOT NULL, description TEXT NOT NULL, published_at TEXT NOT NULL,
        test_ids TEXT NOT NULL, action TEXT NOT NULL, channel TEXT NOT NULL,
        status TEXT NOT NULL, detected_at TEXT NOT NULL, patched_at TEXT,
        UNIQUE(cve_id, service, ecosystem, dependency, current_version)
      );
      CREATE INDEX IF NOT EXISTS idx_cve_status ON cve_findings(status);
      CREATE INDEX IF NOT EXISTS idx_cve_detected ON cve_findings(detected_at);
    `);
    const monitor = new SentinelDependencyMonitor(path.resolve(filePath), database, options);
    await monitor.persist();
    return monitor;
  }

  /**
   * Appends a production dependency snapshot.
   * @param dependencies Captured dependencies from supported manifests.
   * @returns Number of new snapshot rows.
   */
  async captureSnapshot(dependencies: ProductionDependency[]): Promise<number> {
    const capturedAt = this.now().toISOString();
    let added = 0;
    for (const dependency of dependencies) {
      validateDependency(dependency);
      this.database.run(
        `INSERT OR IGNORE INTO dependency_snapshots
         (service, ecosystem, name, version, test_ids, captured_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          dependency.service, dependency.ecosystem, dependency.name,
          dependency.version, JSON.stringify(dependency.testIds), capturedAt
        ]
      );
      added += this.database.getRowsModified();
    }
    await this.persist();
    return added;
  }

  /**
   * Polls the CVE provider for every latest production dependency.
   * Alerts are sent for CVSS scores of 7.0 or greater.
   * @returns Poll findings and alert counts.
   */
  async poll(): Promise<DependencyPollResult> {
    const dependencies = this.dependencies();
    const findings: DependencyFinding[] = [];
    let alertsSent = 0;
    let alertFailures = 0;
    for (const dependency of dependencies) {
      const matches = await this.options.provider(dependency);
      for (const match of matches) {
        validateCve(match, dependency);
        const finding = this.toFinding(dependency, match);
        findings.push(finding);
        this.storeFinding(dependency, finding);
        if (finding.cvssScore >= 7 && this.options.notifier) {
          try {
            await this.options.notifier(stripFinding(finding));
            alertsSent += 1;
          } catch {
            alertFailures += 1;
          }
        }
      }
    }
    await this.persist();
    return {
      dependenciesChecked: dependencies.length,
      cvesFound: findings.length,
      alertsSent,
      alertFailures,
      findings
    };
  }

  /**
   * Marks a finding patched for audit evidence.
   * @param cveId CVE identifier.
   * @param service Affected service.
   * @param dependency Dependency name.
   * @returns Updated finding count.
   */
  async markPatched(cveId: string, service: string, dependency: string): Promise<number> {
    required(cveId, 'cveId');
    required(service, 'service');
    required(dependency, 'dependency');
    this.database.run(
      `UPDATE cve_findings SET status = 'patched', patched_at = ?
       WHERE cve_id = ? AND service = ? AND dependency = ?`,
      [this.now().toISOString(), cveId, service, dependency]
    );
    const changed = this.database.getRowsModified();
    await this.persist();
    return changed;
  }

  /**
   * Generates SOC 2 monitoring and patch compliance evidence.
   * @param from Inclusive period start.
   * @param to Inclusive period end.
   * @returns Audit-ready compliance summary.
   */
  soc2Report(from: string, to: string): Soc2CveReport {
    const start = validDate(from, 'from');
    const end = validDate(to, 'to');
    if (start > end) throw new Error('from must be before or equal to to');
    const evidence = this.findings().filter(item => {
      const time = Date.parse(item.detectedAt);
      return time >= start && time <= end;
    });
    const patched = evidence.filter(item => item.status === 'patched').length;
    return {
      generatedAt: this.now().toISOString(),
      periodFrom: new Date(start).toISOString(),
      periodTo: new Date(end).toISOString(),
      monitoredDependencies: this.dependencies().length,
      findings: evidence.length,
      open: evidence.length - patched,
      patched,
      critical: evidence.filter(item => item.severity === 'CRITICAL').length,
      high: evidence.filter(item => item.severity === 'HIGH').length,
      medium: evidence.filter(item => item.severity === 'MEDIUM').length,
      patchCompliancePercent: evidence.length ? Math.round(patched / evidence.length * 10000) / 100 : 100,
      evidence
    };
  }

  private toFinding(dependency: ProductionDependency, match: CveMatch): DependencyFinding {
    const fixed = match.fixedVersion;
    return {
      cveId: match.cveId,
      severity: classifyCvss(match.cvssScore),
      service: dependency.service,
      dependency: dependency.name,
      currentVersion: dependency.version,
      testCoverage: [...dependency.testIds],
      action: fixed
        ? `Upgrade ${dependency.name} to ${fixed} to fix ${match.cveId}`
        : `No fixed version published for ${match.cveId}; mitigate and monitor`,
      channel: this.options.alertChannel ?? 'slack',
      cvssScore: match.cvssScore,
      description: match.description,
      publishedAt: new Date(match.publishedAt).toISOString(),
      status: 'open',
      detectedAt: this.now().toISOString()
    };
  }

  private storeFinding(dependency: ProductionDependency, finding: DependencyFinding): void {
    this.database.run(
      `INSERT OR IGNORE INTO cve_findings
       (cve_id, service, ecosystem, dependency, current_version, cvss_score,
        severity, description, published_at, test_ids, action, channel, status, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        finding.cveId, finding.service, dependency.ecosystem, finding.dependency,
        finding.currentVersion, finding.cvssScore, finding.severity, finding.description,
        finding.publishedAt, JSON.stringify(finding.testCoverage), finding.action,
        finding.channel, finding.status, finding.detectedAt
      ]
    );
  }

  private dependencies(): ProductionDependency[] {
    const rows = this.database.exec(
      `SELECT service, ecosystem, name, version, test_ids
       FROM dependency_snapshots ORDER BY service, ecosystem, name`
    );
    return rows[0]?.values.map(row => ({
      service: row[0] as string,
      ecosystem: row[1] as DependencyEcosystem,
      name: row[2] as string,
      version: row[3] as string,
      testIds: JSON.parse(row[4] as string) as string[]
    })) ?? [];
  }

  private findings(): DependencyFinding[] {
    const rows = this.database.exec(
      `SELECT cve_id, severity, service, dependency, current_version, test_ids,
       action, channel, cvss_score, description, published_at, status, detected_at, patched_at
       FROM cve_findings ORDER BY detected_at, cve_id`
    );
    return rows[0]?.values.map(row => ({
      cveId: row[0] as string,
      severity: row[1] as CveSeverity,
      service: row[2] as string,
      dependency: row[3] as string,
      currentVersion: row[4] as string,
      testCoverage: JSON.parse(row[5] as string) as string[],
      action: row[6] as string,
      channel: row[7] as 'slack' | 'email',
      cvssScore: row[8] as number,
      description: row[9] as string,
      publishedAt: row[10] as string,
      status: row[11] as 'open' | 'patched',
      detectedAt: row[12] as string,
      ...(row[13] ? { patchedAt: row[13] as string } : {})
    })) ?? [];
  }

  private now(): Date {
    const value = this.options.now?.() ?? new Date();
    if (!Number.isFinite(value.getTime())) throw new Error('Current time must be valid');
    return value;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}

/** Parses npm package-lock v2/v3 dependencies. */
export function parseNpmLock(content: string, service: string, testIds: string[] = []): ProductionDependency[] {
  required(service, 'service');
  let document: unknown;
  try { document = JSON.parse(content); } catch { throw new Error('Invalid package-lock JSON'); }
  const packages = (document as { packages?: Record<string, { version?: string }> }).packages;
  if (!packages) throw new Error('package-lock packages are required');
  return Object.entries(packages)
    .filter(([key, value]) => key.startsWith('node_modules/') && value.version)
    .map(([key, value]) => ({
      service, ecosystem: 'npm' as const, name: key.slice('node_modules/'.length),
      version: value.version as string, testIds: [...testIds]
    }));
}

/** Parses pinned Python requirements. */
export function parseRequirements(content: string, service: string, testIds: string[] = []): ProductionDependency[] {
  required(service, 'service');
  return content.split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const match = line.match(/^([A-Za-z0-9_.-]+)==([^\s;]+)(?:\s*;.*)?$/);
      if (!match) throw new Error(`Requirement must use a pinned == version: ${line}`);
      return { service, ecosystem: 'pip' as const, name: match[1], version: match[2], testIds: [...testIds] };
    });
}

/** Parses Maven pom.xml dependency coordinates without adding an XML runtime. */
export function parsePom(content: string, service: string, testIds: string[] = []): ProductionDependency[] {
  required(service, 'service');
  const blocks = [...content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)];
  return blocks.map(block => {
    const group = xmlValue(block[1], 'groupId');
    const artifact = xmlValue(block[1], 'artifactId');
    const version = xmlValue(block[1], 'version');
    if (!group || !artifact || !version || version.includes('${')) throw new Error('Maven dependencies require explicit groupId, artifactId, and version');
    return { service, ecosystem: 'maven', name: `${group}:${artifact}`, version, testIds: [...testIds] };
  });
}

/** Maps CVSS to the issue-defined severity thresholds. */
export function classifyCvss(score: number): CveSeverity {
  if (!Number.isFinite(score) || score < 0 || score > 10) throw new Error('CVSS score must be between 0 and 10');
  if (score >= 7) return 'CRITICAL';
  if (score >= 5) return 'HIGH';
  return 'MEDIUM';
}

function stripFinding(finding: DependencyFinding): DependencyAlert {
  const { cveId, severity, service, dependency, currentVersion, testCoverage, action, channel } = finding;
  return { cveId, severity, service, dependency, currentVersion, testCoverage, action, channel };
}

function validateDependency(dependency: ProductionDependency): void {
  required(dependency.service, 'service');
  required(dependency.name, 'dependency name');
  required(dependency.version, 'dependency version');
  if (!['npm', 'pip', 'maven'].includes(dependency.ecosystem)) throw new Error('Unsupported dependency ecosystem');
}

function validateCve(cve: CveMatch, dependency: ProductionDependency): void {
  if (!/^CVE-\d{4}-\d{4,}$/i.test(cve.cveId)) throw new Error(`Invalid CVE id: ${cve.cveId}`);
  if (cve.packageName !== dependency.name || cve.ecosystem !== dependency.ecosystem) throw new Error('CVE does not match dependency');
  classifyCvss(cve.cvssScore);
  validDate(cve.publishedAt, 'publishedAt');
}

function xmlValue(block: string, tag: string): string | undefined {
  return block.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`))?.[1].trim();
}

function validDate(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid date`);
  return timestamp;
}

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}
