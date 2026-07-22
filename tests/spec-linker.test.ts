import { SpecLinkStore, type Requirement, type RequirementCoverage } from '../src/core/spec-link-store';
import {
  createSpecLinks,
  validateSpecLinks,
  linkTest,
  getRequirementsCoverage,
  extendTestMetadata
} from '../src/core/spec-linker';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const TEST_DB = path.join(__dirname, 'test-spec-links.db');

describe('SpecLinkStore', () => {
  beforeEach(async () => {
    try { await rm(TEST_DB); } catch { /* ignore */ }
  });

  afterEach(async () => {
    try { await rm(TEST_DB); } catch { /* ignore */ }
  });

  it('creates a new database and schema', async () => {
    const store = await SpecLinkStore.open(TEST_DB);
    expect(store).toBeDefined();
  });

  describe('createRequirement', () => {
    it('stores a requirement with order', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const id = await store.createRequirement('PROJ-123', 'User can log in', 1);
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('stores multiple requirements with unique orders', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const id1 = await store.createRequirement('PROJ-123', 'First requirement', 1);
      const id2 = await store.createRequirement('PROJ-123', 'Second requirement', 2);
      expect(id1).not.toBe(id2);
    });
  });

  describe('getRequirements', () => {
    it('retrieves all requirements for a JIRA issue in order', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      await store.createRequirement('PROJ-123', 'First criterion', 1);
      await store.createRequirement('PROJ-123', 'Second criterion', 2);
      await store.createRequirement('PROJ-456', 'Different issue', 1);

      const reqs = await store.getRequirements('PROJ-123');
      expect(reqs).toHaveLength(2);
      expect(reqs[0].requirement_text).toBe('First criterion');
      expect(reqs[1].requirement_text).toBe('Second criterion');
    });

    it('returns empty array for non-existent JIRA issue', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const reqs = await store.getRequirements('NONEXISTENT-123');
      expect(reqs).toEqual([]);
    });
  });

  describe('linkTestToRequirement', () => {
    it('links a test to a requirement', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const reqId = await store.createRequirement('PROJ-123', 'Test login flow', 1);
      await store.linkTestToRequirement(reqId, 'test-001', 'Login Test', 'PASSED');

      const tests = await store.getRequirementTests(reqId);
      expect(tests).toHaveLength(1);
      expect(tests[0].test_id).toBe('test-001');
      expect(tests[0].test_status).toBe('PASSED');
    });

    it('updates existing test link when re-linking', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const reqId = await store.createRequirement('PROJ-123', 'Test flow', 1);
      await store.linkTestToRequirement(reqId, 'test-001', 'Login Test', 'PENDING');
      await store.linkTestToRequirement(reqId, 'test-001', 'Login Test Updated', 'PASSED');

      const tests = await store.getRequirementTests(reqId);
      expect(tests).toHaveLength(1);
      expect(tests[0].test_status).toBe('PASSED');
      expect(tests[0].test_name).toBe('Login Test Updated');
    });

    it('links multiple tests to one requirement', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const reqId = await store.createRequirement('PROJ-123', 'Test flow', 1);
      await store.linkTestToRequirement(reqId, 'test-001', 'Login Test', 'PASSED');
      await store.linkTestToRequirement(reqId, 'test-002', 'Login with OTP', 'PENDING');

      const tests = await store.getRequirementTests(reqId);
      expect(tests).toHaveLength(2);
    });
  });

  describe('getRequirementCoverage', () => {
    it('calculates coverage with linked tests', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const reqId1 = await store.createRequirement('PROJ-123', 'Login requirement', 1);
      const reqId2 = await store.createRequirement('PROJ-123', 'Logout requirement', 2);
      await store.linkTestToRequirement(reqId1, 'test-001', 'Login Test', 'PASSED');

      const coverage = await store.getRequirementCoverage('PROJ-123');
      expect(coverage).toHaveLength(2);
      expect(coverage[0].linked_test_count).toBe(1);
      expect(coverage[0].has_passed_test).toBe(true);
      expect(coverage[1].linked_test_count).toBe(0);
      expect(coverage[1].has_passed_test).toBe(false);
    });

    it('includes all test names and IDs in coverage', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const reqId = await store.createRequirement('PROJ-123', 'Test requirement', 1);
      await store.linkTestToRequirement(reqId, 'test-001', 'Test One', 'PASSED');
      await store.linkTestToRequirement(reqId, 'test-002', 'Test Two', 'FAILED');

      const coverage = await store.getRequirementCoverage('PROJ-123');
      expect(coverage[0].test_ids).toEqual(['test-001', 'test-002']);
      expect(coverage[0].test_names).toEqual(['Test One', 'Test Two']);
      expect(coverage[0].linked_test_count).toBe(2);
    });
  });

  describe('validateCoverage', () => {
    it('reports total and covered requirements', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      await store.createRequirement('PROJ-123', 'Covered req', 1);
      const reqId2 = await store.createRequirement('PROJ-123', 'Uncovered req', 2);
      await store.createRequirement('PROJ-123', 'Uncovered req 2', 3);
      await store.linkTestToRequirement(1, 'test-001', 'Test One', 'PASSED');

      const validation = await store.validateCoverage('PROJ-123');
      expect(validation.total).toBe(3);
      expect(validation.covered).toBe(1);
      expect(validation.uncovered).toEqual(['Uncovered req', 'Uncovered req 2']);
    });
  });

  describe('extendTestMetadata', () => {
    it('returns base metadata for unlinked test', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const base = { custom_field: 'value' };
      const extended = await store.extendTestMetadata('unlinked-test', base);
      expect(extended).toEqual(base);
    });

    it('extends metadata with requirement info for linked test', async () => {
      const store = await SpecLinkStore.open(TEST_DB);
      const reqId = await store.createRequirement('PROJ-123', 'Test requirement', 1);
      await store.linkTestToRequirement(reqId, 'test-001', 'Test Name', 'PASSED');

      const extended = await store.extendTestMetadata('test-001', { custom: 'value' });
      expect(extended.jira_issue_key).toBe('PROJ-123');
      expect(extended.requirement_text).toBe('Test requirement');
      expect(extended.test_status).toBe('PASSED');
      expect(extended.custom).toBe('value');
    });
  });
});

describe('spec-linker', () => {
  beforeEach(async () => {
    try { await rm(TEST_DB); } catch { /* ignore */ }
  });

  afterEach(async () => {
    try { await rm(TEST_DB); } catch { /* ignore */ }
  });

  describe('createSpecLinks', () => {
    it('parses markdown spec and creates requirements', async () => {
      const spec = `# Acceptance Criteria
- User can log in with email
- User sees dashboard after login
- User can log out`;

      const result = await createSpecLinks({
        jiraIssueKey: 'PROJ-123',
        specText: spec,
        databasePath: TEST_DB
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.requirementCount).toBe(3);
        expect(result.requirementTexts).toContain('User can log in with email');
      }
    });

    it('returns error for empty spec', async () => {
      const result = await createSpecLinks({
        jiraIssueKey: 'PROJ-123',
        specText: '',
        databasePath: TEST_DB
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('empty');
      }
    });

    it('returns error for missing issue key', async () => {
      const result = await createSpecLinks({
        jiraIssueKey: '',
        specText: '- Test criterion',
        databasePath: TEST_DB
      });

      expect(result.ok).toBe(false);
    });

    it('parses Given/When/Then scenarios', async () => {
      const spec = `Given user is on login page
When user enters credentials
Then user sees dashboard`;

      const result = await createSpecLinks({
        jiraIssueKey: 'PROJ-456',
        specText: spec,
        databasePath: TEST_DB
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.requirementCount).toBe(1);
      }
    });
  });

  describe('validateSpecLinks', () => {
    it('calculates coverage percentage', async () => {
      const spec = `- Requirement 1\n- Requirement 2\n- Requirement 3`;
      const createResult = await createSpecLinks({
        jiraIssueKey: 'PROJ-123',
        specText: spec,
        databasePath: TEST_DB
      });

      expect(createResult.ok).toBe(true);

      await linkTest({
        testId: 'test-001',
        testName: 'Test 1',
        jiraIssueKey: 'PROJ-123',
        requirementOrder: 1,
        testStatus: 'PASSED',
        databasePath: TEST_DB
      });

      await linkTest({
        testId: 'test-002',
        testName: 'Test 2',
        jiraIssueKey: 'PROJ-123',
        requirementOrder: 2,
        testStatus: 'PASSED',
        databasePath: TEST_DB
      });

      const validation = await validateSpecLinks({
        jiraIssueKey: 'PROJ-123',
        databasePath: TEST_DB
      });

      expect(validation.ok).toBe(true);
      if (validation.ok) {
        expect(validation.totalRequirements).toBe(3);
        expect(validation.coveredRequirements).toBe(2);
        expect(validation.coveragePercentage).toBe(66);
        expect(validation.uncoveredRequirements).toHaveLength(1);
      }
    });

    it('returns 0 coverage for non-existent issue', async () => {
      const validation = await validateSpecLinks({
        jiraIssueKey: 'NONEXISTENT-999',
        databasePath: TEST_DB
      });

      expect(validation.ok).toBe(true);
      if (validation.ok) {
        expect(validation.totalRequirements).toBe(0);
        expect(validation.coveragePercentage).toBe(0);
      }
    });
  });

  describe('linkTest', () => {
    it('links a test to a requirement by order', async () => {
      const spec = `- Requirement 1\n- Requirement 2`;
      await createSpecLinks({
        jiraIssueKey: 'PROJ-123',
        specText: spec,
        databasePath: TEST_DB
      });

      const result = await linkTest({
        testId: 'test-001',
        testName: 'My Test',
        jiraIssueKey: 'PROJ-123',
        requirementOrder: 2,
        testStatus: 'PASSED',
        databasePath: TEST_DB
      });

      expect(result.ok).toBe(true);
    });

    it('returns error for missing requirement', async () => {
      const result = await linkTest({
        testId: 'test-001',
        testName: 'My Test',
        jiraIssueKey: 'NONEXISTENT-999',
        requirementOrder: 1,
        databasePath: TEST_DB
      });

      expect(result.ok).toBe(false);
    });

    it('validates test ID is not empty', async () => {
      const result = await linkTest({
        testId: '',
        testName: 'My Test',
        jiraIssueKey: 'PROJ-123',
        requirementOrder: 1,
        databasePath: TEST_DB
      });

      expect(result.ok).toBe(false);
    });

    it('validates requirement order is >= 1', async () => {
      const result = await linkTest({
        testId: 'test-001',
        testName: 'My Test',
        jiraIssueKey: 'PROJ-123',
        requirementOrder: 0,
        databasePath: TEST_DB
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('getRequirementsCoverage', () => {
    it('retrieves coverage for all requirements', async () => {
      const spec = `- Requirement 1\n- Requirement 2`;
      await createSpecLinks({
        jiraIssueKey: 'PROJ-123',
        specText: spec,
        databasePath: TEST_DB
      });

      await linkTest({
        testId: 'test-001',
        testName: 'Test 1',
        jiraIssueKey: 'PROJ-123',
        requirementOrder: 1,
        testStatus: 'PASSED',
        databasePath: TEST_DB
      });

      const coverage = await getRequirementsCoverage('PROJ-123', TEST_DB);
      expect(coverage).toHaveLength(2);
      expect(coverage[0].linked_test_count).toBe(1);
      expect(coverage[1].linked_test_count).toBe(0);
    });
  });

  describe('extendTestMetadata', () => {
    it('adds requirement info to test metadata', async () => {
      const spec = `- Test requirement`;
      await createSpecLinks({
        jiraIssueKey: 'PROJ-123',
        specText: spec,
        databasePath: TEST_DB
      });

      await linkTest({
        testId: 'test-001',
        testName: 'Test 1',
        jiraIssueKey: 'PROJ-123',
        requirementOrder: 1,
        testStatus: 'PASSED',
        databasePath: TEST_DB
      });

      const extended = await extendTestMetadata('test-001', TEST_DB, { custom: 'field' });
      expect(extended.jira_issue_key).toBe('PROJ-123');
      expect(extended.requirement_text).toBe('Test requirement');
      expect(extended.test_status).toBe('PASSED');
      expect(extended.custom).toBe('field');
    });
  });
});
