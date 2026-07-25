/** Tests for dashboard CLI command. */
import { dashboardCommand } from '../../src/cli/dashboard';
import { GoldenThreadStore } from '../../src/core/golden-thread-store';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

describe('Dashboard CLI Command', () => {
  const testDbPath = path.join(__dirname, '.tmp-test-dashboard.sqlite');
  const outputPath = path.join(__dirname, '.tmp-dashboard.html');
  const pdfPath = path.join(__dirname, '.tmp-dashboard.pdf.html');

  afterEach(() => {
    [testDbPath, outputPath, pdfPath].forEach(p => {
      if (existsSync(p)) rmSync(p, { force: true });
    });
  });

  async function setupTestDb(): Promise<void> {
    const store = await GoldenThreadStore.open(testDbPath);
    const chainId = await store.initiate('test', 'http://example.com/spec', { environment: 'prod', team: 'TeamA' });
    await store.linkStage(chainId, 2, 'PASSED', 'test', 'http://example.com/test', { environment: 'prod' });
    await store.linkStage(chainId, 3, 'PASSED', 'test', 'http://example.com/evidence', { environment: 'prod' });
  }

  it('generates dashboard HTML to file', async () => {
    await setupTestDb();

    await dashboardCommand({ database: testDbPath, output: outputPath });

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('Golden Thread');
  });

  it('uses default output path', async () => {
    await setupTestDb();
    const defaultPath = './prova-dashboard.html';

    try {
      await dashboardCommand({ database: testDbPath, output: defaultPath });
      expect(existsSync(defaultPath)).toBe(true);
    } finally {
      if (existsSync(defaultPath)) rmSync(defaultPath, { force: true });
    }
  });

  it('generates PDF report HTML', async () => {
    await setupTestDb();

    await dashboardCommand({ database: testDbPath, output: outputPath, pdf: pdfPath });

    expect(existsSync(outputPath)).toBe(true);
    const pdfHtmlPath = pdfPath.replace(/\.pdf$/, '.html');
    expect(existsSync(pdfHtmlPath)).toBe(true);

    if (existsSync(pdfHtmlPath)) {
      const content = readFileSync(pdfHtmlPath, 'utf-8');
      expect(content).toContain('Traceability Report');
    }
  });

  it('applies date range filter', async () => {
    await setupTestDb();
    const futureDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    await dashboardCommand({
      database: testDbPath,
      output: outputPath,
      dateEnd: futureDate
    });

    expect(existsSync(outputPath)).toBe(true);
  });

  it('applies environment filter', async () => {
    await setupTestDb();

    await dashboardCommand({
      database: testDbPath,
      output: outputPath,
      environment: 'prod'
    });

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toBeDefined();
  });

  it('applies team filter', async () => {
    await setupTestDb();

    await dashboardCommand({
      database: testDbPath,
      output: outputPath,
      team: 'TeamA'
    });

    expect(existsSync(outputPath)).toBe(true);
  });

  it('applies project filter', async () => {
    await setupTestDb();

    await dashboardCommand({
      database: testDbPath,
      output: outputPath,
      project: 'NonExistent'
    });

    expect(existsSync(outputPath)).toBe(false);
  });

  it('applies dark mode', async () => {
    await setupTestDb();

    await dashboardCommand({
      database: testDbPath,
      output: outputPath,
      darkMode: true
    });

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('#1a1a1a');
  });

  it('handles empty database gracefully', async () => {
    const emptyDb = path.join(__dirname, '.tmp-empty.sqlite');

    try {
      await GoldenThreadStore.open(emptyDb);
      await dashboardCommand({ database: emptyDb, output: outputPath });
      expect(existsSync(outputPath)).toBe(true);
      const content = readFileSync(outputPath, 'utf-8');
      expect(content).toContain('<!DOCTYPE html>');
      expect(content).toContain('Golden Thread');
    } finally {
      if (existsSync(emptyDb)) rmSync(emptyDb, { force: true });
    }
  });

  it('handles filters that match nothing', async () => {
    await setupTestDb();

    await dashboardCommand({
      database: testDbPath,
      output: outputPath,
      environment: 'nonexistent'
    });

    expect(existsSync(outputPath)).toBe(false);
  });

  it('handles invalid date formats gracefully', async () => {
    await setupTestDb();

    await dashboardCommand({
      database: testDbPath,
      output: outputPath,
      dateStart: 'invalid-date'
    });

    expect(existsSync(outputPath)).toBe(true);
  });

  it('creates output directory if it does not exist', async () => {
    await setupTestDb();
    const nestedPath = path.join(__dirname, '.tmp-nested', 'dir', 'dashboard.html');

    try {
      await dashboardCommand({ database: testDbPath, output: nestedPath });
      expect(existsSync(nestedPath)).toBe(true);
    } finally {
      const nestedDir = path.dirname(nestedPath);
      if (existsSync(nestedDir)) rmSync(nestedDir, { recursive: true, force: true });
    }
  });
});
