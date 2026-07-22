/** SQLite-backed spec link store for requirement-to-test traceability. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Represents a single acceptance criterion/requirement from a JIRA issue. */
export interface Requirement {
  id?: number;
  jira_issue_key: string;
  requirement_text: string;
  requirement_order: number;
  created_at?: string;
}

/** Links a requirement to a test case. */
export interface RequirementTest {
  requirement_id: number;
  test_id: string;
  test_name: string;
  test_status: 'PASSED' | 'FAILED' | 'PENDING';
  last_run?: string;
}

/** Coverage info for a single requirement. */
export interface RequirementCoverage {
  requirement_text: string;
  requirement_order: number;
  linked_test_count: number;
  test_ids: string[];
  test_names: string[];
  has_passed_test: boolean;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;

function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed repository for spec-to-test linking. */
export class SpecLinkStore {
  private constructor(private readonly filePath: string, private readonly database: Database) {}

  /** Opens or creates a spec link database. */
  static async open(filePath: string): Promise<SpecLinkStore> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jira_issue_key TEXT NOT NULL,
        requirement_text TEXT NOT NULL,
        requirement_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(jira_issue_key, requirement_order)
      );
      CREATE TABLE IF NOT EXISTS requirement_tests (
        requirement_id INTEGER NOT NULL,
        test_id TEXT NOT NULL,
        test_name TEXT NOT NULL,
        test_status TEXT NOT NULL CHECK(test_status IN ('PASSED','FAILED','PENDING')),
        last_run TEXT,
        FOREIGN KEY (requirement_id) REFERENCES requirements(id),
        UNIQUE(requirement_id, test_id)
      );
      CREATE INDEX IF NOT EXISTS idx_requirements_jira ON requirements(jira_issue_key);
      CREATE INDEX IF NOT EXISTS idx_requirement_tests_status ON requirement_tests(test_status);
    `);
    const store = new SpecLinkStore(path.resolve(filePath), database);
    await store.persist();
    return store;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const bytes = this.database.export();
    const buffer = Buffer.from(bytes);
    await writeFile(this.filePath, buffer);
  }

  /** Stores a requirement from a parsed acceptance criterion. */
  async createRequirement(jiraIssueKey: string, requirementText: string, order: number): Promise<number> {
    const now = new Date().toISOString();
    this.database.run(
      `INSERT INTO requirements (jira_issue_key, requirement_text, requirement_order, created_at)
       VALUES (?, ?, ?, ?)`,
      [jiraIssueKey, requirementText, order, now]
    );
    const result = this.database.exec('SELECT last_insert_rowid() as id');
    const id = result[0]?.values[0]?.[0] as number | undefined;
    if (id === undefined) throw new Error('Failed to get inserted requirement ID');
    await this.persist();
    return id;
  }

  /** Links a test to a requirement. */
  async linkTestToRequirement(
    requirementId: number,
    testId: string,
    testName: string,
    testStatus: 'PASSED' | 'FAILED' | 'PENDING' = 'PENDING'
  ): Promise<void> {
    const now = new Date().toISOString();
    try {
      this.database.run(
        `INSERT INTO requirement_tests (requirement_id, test_id, test_name, test_status, last_run)
         VALUES (?, ?, ?, ?, ?)`,
        [requirementId, testId, testName, testStatus, now]
      );
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE')) {
        this.database.run(
          `UPDATE requirement_tests SET test_name = ?, test_status = ?, last_run = ?
           WHERE requirement_id = ? AND test_id = ?`,
          [testName, testStatus, now, requirementId, testId]
        );
      } else {
        throw error;
      }
    }
    await this.persist();
  }

  /** Retrieves all requirements for a JIRA issue. */
  async getRequirements(jiraIssueKey: string): Promise<Requirement[]> {
    const rows = this.database.exec(
      `SELECT id, jira_issue_key, requirement_text, requirement_order, created_at
       FROM requirements WHERE jira_issue_key = ? ORDER BY requirement_order ASC`,
      [jiraIssueKey]
    );
    return (rows[0]?.values || []).map((row) => ({
      id: row[0] as number,
      jira_issue_key: row[1] as string,
      requirement_text: row[2] as string,
      requirement_order: row[3] as number,
      created_at: row[4] as string
    }));
  }

  /** Retrieves all linked tests for a requirement. */
  async getRequirementTests(requirementId: number): Promise<RequirementTest[]> {
    const rows = this.database.exec(
      `SELECT requirement_id, test_id, test_name, test_status, last_run
       FROM requirement_tests WHERE requirement_id = ?`,
      [requirementId]
    );
    return (rows[0]?.values || []).map((row) => ({
      requirement_id: row[0] as number,
      test_id: row[1] as string,
      test_name: row[2] as string,
      test_status: row[3] as 'PASSED' | 'FAILED' | 'PENDING',
      last_run: row[4] as string | undefined
    }));
  }

  /** Calculates coverage information for all requirements in a JIRA issue. */
  async getRequirementCoverage(jiraIssueKey: string): Promise<RequirementCoverage[]> {
    const requirements = await this.getRequirements(jiraIssueKey);
    const coverage: RequirementCoverage[] = [];

    for (const req of requirements) {
      if (req.id === undefined) continue;
      const tests = await this.getRequirementTests(req.id);
      const hasPassedTest = tests.some((t) => t.test_status === 'PASSED');

      coverage.push({
        requirement_text: req.requirement_text,
        requirement_order: req.requirement_order,
        linked_test_count: tests.length,
        test_ids: tests.map((t) => t.test_id),
        test_names: tests.map((t) => t.test_name),
        has_passed_test: hasPassedTest
      });
    }

    return coverage;
  }

  /** Validates coverage and returns warnings for uncovered requirements. */
  async validateCoverage(jiraIssueKey: string): Promise<{ uncovered: string[]; total: number; covered: number }> {
    const coverage = await this.getRequirementCoverage(jiraIssueKey);
    const uncovered = coverage
      .filter((c) => c.linked_test_count === 0)
      .map((c) => c.requirement_text);

    return {
      uncovered,
      total: coverage.length,
      covered: coverage.filter((c) => c.linked_test_count > 0).length
    };
  }

  /** Extends test metadata with requirement information. */
  async extendTestMetadata(
    testId: string,
    baseMetadata?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const rows = this.database.exec(
      `SELECT r.jira_issue_key, r.requirement_text, rt.test_status
       FROM requirement_tests rt
       JOIN requirements r ON rt.requirement_id = r.id
       WHERE rt.test_id = ?`,
      [testId]
    );

    if (!rows[0]?.values.length) {
      return baseMetadata || {};
    }

    const [jiraIssueKey, requirementText, testStatus] = rows[0].values[0] as [string, string, string];
    return {
      ...baseMetadata,
      jira_issue_key: jiraIssueKey,
      requirement_text: requirementText,
      test_status: testStatus,
      linked_at: new Date().toISOString()
    };
  }
}
