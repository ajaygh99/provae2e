import {
  TestDataLineageTracker,
  validateTestData,
  type RegisterTestDataInput,
  type TestDataCleaner,
  type TestDataRecord,
  type TestDataSource
} from '../../src/core/test-data-lineage.js';

function input(id = 'data-1', sourceType: TestDataSource = 'factory'): RegisterTestDataInput {
  return { id, runId: 'run-1', sourceType, payload: { email: `${id}@example.com` }, tags: ['checkout'] };
}

function cleaner(options: { stillExists?: string[]; failRemove?: string[] } = {}): TestDataCleaner {
  return {
    remove: jest.fn(async (record: TestDataRecord) => {
      if (options.failRemove?.includes(record.id)) throw new Error('delete failed');
    }),
    exists: jest.fn(async (record: TestDataRecord) => options.stillExists?.includes(record.id) ?? false)
  };
}

describe('Golden Thread test-data lineage', () => {
  describe('registration and tagging', () => {
    it.each<TestDataSource>(['factory', 'fixture', 'seed'])('tags %s data with its source', source => {
      const record = new TestDataLineageTracker().register(input('data-1', source));
      expect(record.sourceType).toBe(source);
      expect(record.tags).toContain(`source:${source}`);
      expect(record.tags).toContain('environment:sandbox');
    });

    it('starts every record in the created lifecycle', () => {
      expect(new TestDataLineageTracker().register(input()).lifecycle).toBe('created');
    });

    it('deduplicates and removes blank custom tags', () => {
      const tracker = new TestDataLineageTracker();
      const record = tracker.register({ ...input(), tags: ['checkout', 'checkout', ' '] });
      expect(record.tags.filter(tag => tag === 'checkout')).toHaveLength(1);
      expect(record.tags).not.toContain('');
    });

    it('rejects production data creation', () => {
      const tracker = new TestDataLineageTracker();
      expect(() => tracker.register({ ...input(), environment: 'production' })).toThrow('restricted to sandbox');
    });

    it('rejects duplicate identifiers', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      expect(() => tracker.register(input())).toThrow('already registered');
    });

    it('rejects blank data and run identifiers', () => {
      const tracker = new TestDataLineageTracker();
      expect(() => tracker.register({ ...input(), id: ' ' })).toThrow('Data id');
      expect(() => tracker.register({ ...input(), runId: '' })).toThrow('Run id');
    });

    it('rejects invalid runtime source values', () => {
      const tracker = new TestDataLineageTracker();
      expect(() => tracker.register({ ...input(), sourceType: 'copy' as TestDataSource })).toThrow('Invalid test data source');
    });

    it('returns immutable snapshots', () => {
      const tracker = new TestDataLineageTracker();
      const record = tracker.register(input());
      record.tags.push('mutated');
      expect(tracker.get(record.id)?.tags).not.toContain('mutated');
    });

    it('lists only records from the selected run', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input('one'));
      tracker.register({ ...input('two'), runId: 'run-2' });
      expect(tracker.listRun('run-1').map(record => record.id)).toEqual(['one']);
    });
  });

  describe('production-like data validation', () => {
    it('accepts example.com email addresses', () => {
      expect(validateTestData({ email: 'qa@example.com' })).toEqual([]);
    });

    it('accepts example.com subdomains case-insensitively', () => {
      expect(validateTestData('QA@SANDBOX.EXAMPLE.COM')).toEqual([]);
    });

    it('warns for a real-looking email domain', () => {
      expect(validateTestData({ email: 'person@gmail.com' })[0]).toMatchObject({ path: '$.email', kind: 'real-email' });
    });

    it('finds multiple email addresses in one string', () => {
      expect(validateTestData('a@gmail.com and b@company.org')).toHaveLength(2);
    });

    it('warns for valid-looking SSNs without exposing the full number', () => {
      const warning = validateTestData({ ssn: '123-45-6789' })[0];
      expect(warning).toMatchObject({ path: '$.ssn', kind: 'ssn' });
      expect(warning.message).toContain('***-**-6789');
      expect(warning.message).not.toContain('123-45-6789');
    });

    it.each(['000-12-3456', '666-12-3456', '900-12-3456', '123-00-3456', '123-45-0000'])('accepts invalid/fake SSN %s', ssn => {
      expect(validateTestData(ssn)).toEqual([]);
    });

    it('reports nested array paths', () => {
      expect(validateTestData({ users: [{ email: 'real@company.com' }] })[0].path).toBe('$.users[0].email');
    });

    it('handles circular object references safely', () => {
      const payload: { self?: unknown; email: string } = { email: 'qa@example.com' };
      payload.self = payload;
      expect(validateTestData(payload)).toEqual([]);
    });

    it('stores validation warnings on registration', () => {
      const record = new TestDataLineageTracker().register({ ...input(), payload: { email: 'real@company.com' } });
      expect(record.warnings).toHaveLength(1);
    });
  });

  describe('usage and database impact lineage', () => {
    it('links data to a test execution', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      const record = tracker.markUsed('data-1', 'test-42');
      expect(record).toMatchObject({ lifecycle: 'used', testExecutionId: 'test-42' });
      expect(record.usedAt).toBeDefined();
    });

    it('rejects unknown data and blank execution ids', () => {
      const tracker = new TestDataLineageTracker();
      expect(() => tracker.markUsed('missing', 'test')).toThrow('Unknown test data');
      tracker.register(input());
      expect(() => tracker.markUsed('data-1', ' ')).toThrow('Test execution id');
    });

    it('allows and records sandbox database impact', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      tracker.markUsed('data-1', 'test-42');
      expect(tracker.recordImpact('data-1', { environment: 'sandbox', database: 'qe', table: 'orders', operation: 'insert' }))
        .toMatchObject({ allowed: true, testExecutionId: 'test-42' });
    });

    it('blocks and retains production impact evidence', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      tracker.markUsed('data-1', 'test-42');
      expect(tracker.recordImpact('data-1', { environment: 'production', database: 'prod', table: 'orders', operation: 'insert' }).allowed).toBe(false);
      expect(tracker.report('run-1').productionImpactAttempts).toBe(1);
    });

    it('requires execution linkage before impact', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      expect(() => tracker.recordImpact('data-1', { environment: 'sandbox', database: 'qe', table: 'x', operation: 'insert' }))
        .toThrow('linked to an execution');
    });

    it('validates database, table, and operation', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      tracker.markUsed('data-1', 'test');
      expect(() => tracker.recordImpact('data-1', {
        environment: 'unknown' as 'sandbox', database: 'qe', table: 'x', operation: 'insert'
      })).toThrow('environment');
      expect(() => tracker.recordImpact('data-1', { environment: 'sandbox', database: '', table: 'x', operation: 'insert' })).toThrow('Database');
      expect(() => tracker.recordImpact('data-1', { environment: 'sandbox', database: 'qe', table: '', operation: 'insert' })).toThrow('Table');
      expect(() => tracker.recordImpact('data-1', { environment: 'sandbox', database: 'qe', table: 'x', operation: 'merge' as 'insert' })).toThrow('operation');
    });

    it('builds data to execution to impact graph edges', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      tracker.markUsed('data-1', 'test-42');
      tracker.recordImpact('data-1', { environment: 'sandbox', database: 'qe', table: 'orders', operation: 'insert' });
      const graph = tracker.graph('run-1');
      expect(graph.nodes.map(node => node.type)).toEqual(['test-data', 'test-execution', 'database-impact']);
      expect(graph.edges).toEqual([
        { from: 'data:data-1', to: 'execution:test-42', relationship: 'used-by' },
        { from: 'execution:test-42', to: 'impact:data-1:0', relationship: 'impacted' }
      ]);
    });

    it('deduplicates execution nodes shared by multiple records', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input('one'));
      tracker.register(input('two'));
      tracker.markUsed('one', 'same-test');
      tracker.markUsed('two', 'same-test');
      expect(tracker.graph('run-1').nodes.filter(node => node.type === 'test-execution')).toHaveLength(1);
    });
  });

  describe('post-test cleanup and reports', () => {
    it('auto-deletes and verifies all active records', async () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input('one'));
      tracker.register(input('two'));
      tracker.markUsed('two', 'test');
      const result = await tracker.cleanupRun('run-1', cleaner());
      expect(result).toEqual({ runId: 'run-1', attempted: 2, deleted: 2, failed: [], verified: true });
      expect(tracker.listRun('run-1').every(record => record.lifecycle === 'deleted')).toBe(true);
    });

    it('does not attempt already-deleted records twice', async () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      await tracker.cleanupRun('run-1', cleaner());
      expect(await tracker.cleanupRun('run-1', cleaner())).toMatchObject({ attempted: 0, deleted: 0 });
    });

    it('reports removal failures without stopping other cleanup', async () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input('one'));
      tracker.register(input('two'));
      const result = await tracker.cleanupRun('run-1', cleaner({ failRemove: ['one'] }));
      expect(result).toMatchObject({ attempted: 2, deleted: 1, verified: false });
      expect(result.failed).toEqual([{ dataId: 'one', error: 'delete failed' }]);
    });

    it('fails verification when a removed record still exists', async () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      const result = await tracker.cleanupRun('run-1', cleaner({ stillExists: ['data-1'] }));
      expect(result.failed[0].error).toBe('Record still exists after cleanup');
      expect(tracker.get('data-1')?.lifecycle).toBe('created');
    });

    it('prevents reuse after verified deletion', async () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      await tracker.cleanupRun('run-1', cleaner());
      expect(() => tracker.markUsed('data-1', 'test')).toThrow('Deleted test data');
    });

    it('reports 100 percent isolation and zero risk after safe cleanup', async () => {
      const tracker = new TestDataLineageTracker();
      tracker.register(input());
      tracker.markUsed('data-1', 'test');
      tracker.recordImpact('data-1', { environment: 'sandbox', database: 'qe', table: 'orders', operation: 'insert' });
      await tracker.cleanupRun('run-1', cleaner());
      expect(tracker.report('run-1')).toMatchObject({
        isolationPercentage: 100,
        contaminationRisk: 0,
        allDeleted: true,
        createdRealDataInProduction: false,
        productionQuestion: 'Did this test create real data in prod? No, sandbox only.',
        summary: '100% test data isolated, 0 contamination risk'
      });
    });

    it('counts PII, production attempts, and undeleted data as risk', () => {
      const tracker = new TestDataLineageTracker();
      tracker.register({ ...input(), payload: { email: 'real@company.com' } });
      tracker.markUsed('data-1', 'test');
      tracker.recordImpact('data-1', { environment: 'production', database: 'prod', table: 'users', operation: 'insert' });
      expect(tracker.report('run-1')).toMatchObject({ isolationPercentage: 0, contaminationRisk: 3, piiWarnings: 1, productionImpactAttempts: 1, allDeleted: false });
    });

    it('reports an empty run as isolated', () => {
      expect(new TestDataLineageTracker().report('empty')).toMatchObject({ total: 0, isolationPercentage: 100, contaminationRisk: 0 });
    });
  });
});
