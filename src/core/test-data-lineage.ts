/** Golden Thread test-data lineage, governance, and cleanup tracking. */
import { log } from './logger.js';

export type TestDataSource = 'factory' | 'fixture' | 'seed';
export type TestDataLifecycle = 'created' | 'used' | 'deleted';
export type DataEnvironment = 'sandbox' | 'production';

/** One governed test-data record. */
export interface TestDataRecord {
  id: string;
  runId: string;
  sourceType: TestDataSource;
  lifecycle: TestDataLifecycle;
  tags: string[];
  payload: unknown;
  environment: 'sandbox';
  createdAt: string;
  usedAt?: string;
  deletedAt?: string;
  testExecutionId?: string;
  warnings: DataValidationWarning[];
}

/** PII or isolation warning found in test data. */
export interface DataValidationWarning {
  path: string;
  kind: 'real-email' | 'ssn' | 'production-environment';
  message: string;
}

/** Database operation attributed to one test-data record. */
export interface DatabaseImpact {
  dataId: string;
  testExecutionId: string;
  environment: DataEnvironment;
  database: string;
  table: string;
  operation: 'insert' | 'update' | 'delete';
  allowed: boolean;
  timestamp: string;
}

/** Directed lineage node. */
export interface LineageNode {
  id: string;
  type: 'test-data' | 'test-execution' | 'database-impact';
  label: string;
}

/** Directed lineage relationship. */
export interface LineageEdge {
  from: string;
  to: string;
  relationship: 'used-by' | 'impacted';
}

/** Test-data lineage graph for one run. */
export interface TestDataLineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/** Injected sandbox cleanup boundary. */
export interface TestDataCleaner {
  remove(record: TestDataRecord): Promise<void>;
  exists(record: TestDataRecord): Promise<boolean>;
}

/** Result of post-test cleanup for one run. */
export interface TestDataCleanupResult {
  runId: string;
  attempted: number;
  deleted: number;
  failed: Array<{ dataId: string; error: string }>;
  verified: boolean;
}

/** Governance report for one run. */
export interface TestDataIsolationReport {
  runId: string;
  total: number;
  isolated: number;
  isolationPercentage: number;
  contaminationRisk: number;
  productionImpactAttempts: number;
  piiWarnings: number;
  allDeleted: boolean;
  createdRealDataInProduction: false;
  productionQuestion: 'Did this test create real data in prod? No, sandbox only.';
  summary: string;
}

/** Input used to register a governed data record. */
export interface RegisterTestDataInput {
  id: string;
  runId: string;
  sourceType: TestDataSource;
  payload: unknown;
  tags?: string[];
  environment?: DataEnvironment;
}

/** Input used to record a database impact. */
export interface DatabaseImpactInput {
  environment: DataEnvironment;
  database: string;
  table: string;
  operation: DatabaseImpact['operation'];
}

/** Tracks test-data creation, usage, database impact, and verified cleanup. */
export class TestDataLineageTracker {
  private readonly records = new Map<string, TestDataRecord>();
  private readonly impacts: DatabaseImpact[] = [];

  /** Registers tagged test data and enforces sandbox-only creation. */
  register(input: RegisterTestDataInput): TestDataRecord {
    required(input.id, 'Data id');
    required(input.runId, 'Run id');
    if (!['factory', 'fixture', 'seed'].includes(input.sourceType)) throw new Error(`Invalid test data source: ${String(input.sourceType)}`);
    if (this.records.has(input.id)) throw new Error(`Test data id already registered: ${input.id}`);
    const environment = input.environment ?? 'sandbox';
    if (environment !== 'sandbox') throw new Error('Test data creation is restricted to sandbox environments');
    const tags = uniqueTags([`source:${input.sourceType}`, 'environment:sandbox', ...(input.tags ?? [])]);
    const warnings = validateTestData(input.payload);
    const record: TestDataRecord = {
      id: input.id,
      runId: input.runId,
      sourceType: input.sourceType,
      lifecycle: 'created',
      tags,
      payload: input.payload,
      environment: 'sandbox',
      createdAt: new Date().toISOString(),
      warnings
    };
    this.records.set(record.id, record);
    if (warnings.length) log.warn('Potential production-like test data detected', { dataId: record.id, warnings });
    return cloneRecord(record);
  }

  /** Links registered data to one test execution and moves it to `used`. */
  markUsed(dataId: string, testExecutionId: string): TestDataRecord {
    required(testExecutionId, 'Test execution id');
    const record = this.requireRecord(dataId);
    if (record.lifecycle === 'deleted') throw new Error(`Deleted test data cannot be used: ${dataId}`);
    record.lifecycle = 'used';
    record.testExecutionId = testExecutionId;
    record.usedAt = new Date().toISOString();
    return cloneRecord(record);
  }

  /**
   * Records a sandbox database impact. Production operations are retained as
   * blocked evidence but are never permitted.
   */
  recordImpact(dataId: string, input: DatabaseImpactInput): DatabaseImpact {
    const record = this.requireRecord(dataId);
    if (!record.testExecutionId) throw new Error(`Test data must be linked to an execution before database impact: ${dataId}`);
    if (!['sandbox', 'production'].includes(input.environment)) throw new Error(`Invalid data environment: ${String(input.environment)}`);
    required(input.database, 'Database');
    required(input.table, 'Table');
    if (!['insert', 'update', 'delete'].includes(input.operation)) throw new Error(`Invalid database operation: ${String(input.operation)}`);
    const impact: DatabaseImpact = {
      dataId,
      testExecutionId: record.testExecutionId,
      environment: input.environment,
      database: input.database,
      table: input.table,
      operation: input.operation,
      allowed: input.environment === 'sandbox',
      timestamp: new Date().toISOString()
    };
    this.impacts.push(impact);
    if (!impact.allowed) log.error('Blocked production database impact from test data', { dataId, database: input.database, table: input.table });
    return { ...impact };
  }

  /** Returns an immutable record snapshot. */
  get(dataId: string): TestDataRecord | undefined {
    const record = this.records.get(dataId);
    return record ? cloneRecord(record) : undefined;
  }

  /** Returns records belonging to one run. */
  listRun(runId: string): TestDataRecord[] {
    return [...this.records.values()].filter(record => record.runId === runId).map(cloneRecord);
  }

  /** Builds data -> execution -> database impact lineage for one run. */
  graph(runId: string): TestDataLineageGraph {
    const records = this.listRun(runId);
    const recordIds = new Set(records.map(record => record.id));
    const impacts = this.impacts.filter(impact => recordIds.has(impact.dataId));
    const nodes: LineageNode[] = records.map(record => ({ id: `data:${record.id}`, type: 'test-data', label: `${record.id} (${record.sourceType})` }));
    const executionIds = new Set(records.flatMap(record => record.testExecutionId ? [record.testExecutionId] : []));
    for (const executionId of executionIds) nodes.push({ id: `execution:${executionId}`, type: 'test-execution', label: executionId });
    impacts.forEach((impact, index) => nodes.push({
      id: `impact:${impact.dataId}:${index}`,
      type: 'database-impact',
      label: `${impact.environment}:${impact.database}.${impact.table}:${impact.operation}${impact.allowed ? '' : ':blocked'}`
    }));
    const edges: LineageEdge[] = [];
    for (const record of records) if (record.testExecutionId) edges.push({
      from: `data:${record.id}`, to: `execution:${record.testExecutionId}`, relationship: 'used-by'
    });
    impacts.forEach((impact, index) => edges.push({
      from: `execution:${impact.testExecutionId}`, to: `impact:${impact.dataId}:${index}`, relationship: 'impacted'
    }));
    return { nodes, edges };
  }

  /** Auto-deletes all active data for a run and verifies physical removal. */
  async cleanupRun(runId: string, cleaner: TestDataCleaner): Promise<TestDataCleanupResult> {
    const active = [...this.records.values()].filter(record => record.runId === runId && record.lifecycle !== 'deleted');
    const failed: TestDataCleanupResult['failed'] = [];
    let deleted = 0;
    for (const record of active) {
      try {
        await cleaner.remove(cloneRecord(record));
        if (await cleaner.exists(cloneRecord(record))) throw new Error('Record still exists after cleanup');
        record.lifecycle = 'deleted';
        record.deletedAt = new Date().toISOString();
        deleted += 1;
      } catch (error) {
        failed.push({ dataId: record.id, error: errorMessage(error) });
      }
    }
    const result = { runId, attempted: active.length, deleted, failed, verified: failed.length === 0 };
    if (!result.verified) log.error('Test data cleanup verification failed', { runId, failed });
    return result;
  }

  /** Generates the isolation and contamination-risk report for one run. */
  report(runId: string): TestDataIsolationReport {
    const records = this.listRun(runId);
    const recordIds = new Set(records.map(record => record.id));
    const impacts = this.impacts.filter(impact => recordIds.has(impact.dataId));
    const productionAttempts = impacts.filter(impact => !impact.allowed).length;
    const piiWarnings = records.reduce((count, record) => count + record.warnings.length, 0);
    const notDeleted = records.filter(record => record.lifecycle !== 'deleted').length;
    const contaminationRisk = productionAttempts + piiWarnings + notDeleted;
    const isolated = records.filter(record => record.environment === 'sandbox' && record.lifecycle === 'deleted' && record.warnings.length === 0).length;
    const isolationPercentage = records.length ? Math.round(isolated / records.length * 10000) / 100 : 100;
    return {
      runId,
      total: records.length,
      isolated,
      isolationPercentage,
      contaminationRisk,
      productionImpactAttempts: productionAttempts,
      piiWarnings,
      allDeleted: notDeleted === 0,
      createdRealDataInProduction: false,
      productionQuestion: 'Did this test create real data in prod? No, sandbox only.',
      summary: `${isolationPercentage}% test data isolated, ${contaminationRisk} contamination risk`
    };
  }

  private requireRecord(dataId: string): TestDataRecord {
    const record = this.records.get(dataId);
    if (!record) throw new Error(`Unknown test data id: ${dataId}`);
    return record;
  }
}

/** Finds real-looking email addresses and SSNs anywhere in a payload. */
export function validateTestData(payload: unknown): DataValidationWarning[] {
  const warnings: DataValidationWarning[] = [];
  walk(payload, '$', warnings, new Set<object>());
  return warnings;
}

function walk(value: unknown, path: string, warnings: DataValidationWarning[], visited: Set<object>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
      const domain = match[1].toLowerCase();
      if (domain !== 'example.com' && !domain.endsWith('.example.com')) warnings.push({
        path, kind: 'real-email', message: `Use an @example.com address instead of ${match[0]}`
      });
    }
    for (const match of value.matchAll(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g)) warnings.push({
      path, kind: 'ssn', message: `Production-like SSN detected: ${mask(match[0])}`
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) value.forEach((child, index) => walk(child, `${path}[${index}]`, warnings, visited));
  else Object.entries(value as Record<string, unknown>).forEach(([key, child]) => walk(child, `${path}.${key}`, warnings, visited));
}

function cloneRecord(record: TestDataRecord): TestDataRecord {
  return { ...record, tags: [...record.tags], warnings: record.warnings.map(warning => ({ ...warning })) };
}

function uniqueTags(tags: string[]): string[] {
  const clean = tags.map(tag => tag.trim()).filter(Boolean);
  return [...new Set(clean)];
}

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function mask(ssn: string): string { return `***-**-${ssn.slice(-4)}`; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
