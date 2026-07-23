/**
 * Tests for PDF export functionality
 */
import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import { GoldenThreadStore, type Stage } from '../../src/core/golden-thread-store';
import { exportChainToPDF } from '../../src/exporters/pdf-exporter';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, stat } from 'node:fs/promises';

describe('PDF Exporter', () => {
  let dbPath: string;
  let pdfPath: string;

  beforeAll(async () => {
    dbPath = join(tmpdir(), `test-pdf-export-${Date.now()}.db`);
    pdfPath = join(tmpdir(), `test-report-${Date.now()}.pdf`);
  });

  afterEach(async () => {
    try {
      await rm(dbPath, { force: true });
      await rm(pdfPath, { force: true });
    } catch {
      // ignore
    }
  });

  it('should export chain to PDF', async () => {
    const store = await GoldenThreadStore.open(dbPath);

    // Create test chain
    const threadId = await store.initiate('alice', 'https://spec.example.com', {
      issue_key: 'TEST-001'
    });

    await store.linkStage(threadId, 2 as Stage, 'PASSED', 'bob', 'https://test.example.com');
    await store.linkStage(threadId, 3 as Stage, 'PASSED', 'charlie', 'https://evidence.example.com');

    const chain = await store.getChain(threadId);
    if (!chain) throw new Error('Chain not found');

    // Export to PDF
    await exportChainToPDF(chain, pdfPath);

    // Verify file exists and has content
    const stats = await stat(pdfPath);
    expect(stats.size).toBeGreaterThan(0);
  }, 30000); // Longer timeout for PDF generation

  it('should create output directory if not exists', async () => {
    const store = await GoldenThreadStore.open(dbPath);

    const threadId = await store.initiate('alice', 'https://spec.example.com');
    const chain = await store.getChain(threadId);
    if (!chain) throw new Error('Chain not found');

    const nestedPath = join(tmpdir(), `nested-${Date.now()}`, 'path', 'report.pdf');

    await exportChainToPDF(chain, nestedPath);

    const stats = await stat(nestedPath);
    expect(stats.size).toBeGreaterThan(0);

    // Cleanup nested dirs
    try {
      await rm(join(tmpdir(), `nested-${Date.now()}`), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }, 30000);

  it('should handle chains with deployment status', async () => {
    const store = await GoldenThreadStore.open(dbPath);

    const threadId = await store.initiate('alice', 'https://spec.example.com');

    await store.linkStage(
      threadId,
      2 as Stage,
      'PASSED',
      'bob',
      'https://test.example.com',
      {},
      'GREEN'
    );

    await store.linkStage(
      threadId,
      3 as Stage,
      'PASSED',
      'charlie',
      'https://evidence.example.com',
      {},
      'YELLOW'
    );

    const chain = await store.getChain(threadId);
    if (!chain) throw new Error('Chain not found');

    await exportChainToPDF(chain, pdfPath);

    const stats = await stat(pdfPath);
    expect(stats.size).toBeGreaterThan(0);
  }, 30000);
});
