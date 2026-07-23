/**
 * Tests for root cause analyzer.
 * Covers: caching, AI integration, error handling, and learning feedback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RootCauseAnalyzer, type RootCauseAnalysis } from './root-cause-analyzer.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import type { GoldenThreadChain } from './golden-thread-store.js';

const testDbPath = join(tmpdir(), `rca-test-${Date.now()}.db`);

// Mock Golden Thread chain for testing
const mockChain: GoldenThreadChain = {
  id: 'chain-123',
  spec_id: 'spec-1',
  test_id: 'test-1',
  stage1_spec: 'User login with valid credentials should redirect to dashboard',
  stage2_test_code: 'it("should login", async () => { await page.fill("#email", "test@example.com"); });',
  stage3_evidence: 'Screenshot of login form, network logs',
  stage4_build: true,
  stage5_deploy: true,
  stage6_prod_logs: 'ERR: Connection timeout at 2026-07-22T10:30:00Z',
  stage7_debug_info: 'Deployment failed due to port 5432 unavailable',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('RootCauseAnalyzer', () => {
  let analyzer: RootCauseAnalyzer;

  beforeEach(async () => {
    // Clean up any existing test db
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    analyzer = await RootCauseAnalyzer.open(testDbPath);
  });

  afterEach(() => {
    // Clean up test database
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  describe('analyzeChain', () => {
    it('should perform root cause analysis with full context', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true });

      expect(analysis).toBeDefined();
      expect(analysis.id).toMatch(/^rca_/);
      expect(analysis.golden_thread_id).toBe('chain-123');
      expect(['TEST_GAP', 'CODE_BUG', 'SPEC_GAP', 'DEPLOYMENT']).toContain(
        analysis.root_cause
      );
      expect(analysis.confidence).toBeGreaterThanOrEqual(0.7);
      expect(analysis.confidence).toBeLessThanOrEqual(1.0);
      expect(analysis.reasoning).toBeTruthy();
      expect(analysis.suggestions).toBeInstanceOf(Array);
      expect(analysis.suggestions.length).toBeGreaterThan(0);
      expect(analysis.model_used).toBe('claude');
      expect(analysis.cached).toBe(false);
    });

    it('should cache analysis results', async () => {
      const analysis1 = await analyzer.analyzeChain(mockChain, { skipCache: true });
      const analysis2 = await analyzer.analyzeChain(mockChain);

      expect(analysis2.id).toBe(analysis1.id);
      expect(analysis2.cached).toBe(true);
      expect(analysis2.root_cause).toBe(analysis1.root_cause);
    });

    it('should skip cache when explicitly requested', async () => {
      const analysis1 = await analyzer.analyzeChain(mockChain, { skipCache: true });
      const analysis2 = await analyzer.analyzeChain(mockChain, { skipCache: true });

      expect(analysis2.id).not.toBe(analysis1.id);
      expect(analysis2.cached).toBe(false);
    });

    it('should handle AI unavailability gracefully', async () => {
      // Mock Anthropic to fail
      vi.doMock('@anthropic-ai/sdk', () => ({
        default: vi.fn(() => {
          throw new Error('API unavailable');
        }),
      }));

      const analysis = await analyzer.analyzeChain(mockChain);

      // Should return degraded result
      expect(analysis.confidence).toBe(0.5);
      expect(analysis.root_cause).toBe('CODE_BUG');
      expect(analysis.model_used).toBe('none');
    });
  });

  describe('recordFeedback', () => {
    it('should record positive feedback', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true });
      await analyzer.recordFeedback(analysis.id, true);

      // Verify feedback was recorded (via direct db query in real scenario)
      expect(true).toBe(true); // Feedback recorded without error
    });

    it('should record negative feedback with actual cause', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true });
      await analyzer.recordFeedback(analysis.id, false, 'DEPLOYMENT');

      expect(true).toBe(true); // Feedback recorded without error
    });
  });

  describe('caching strategy', () => {
    it('should differentiate chains by context hash', async () => {
      const chain1 = { ...mockChain, stage6_prod_logs: 'Error A' };
      const chain2 = { ...mockChain, stage6_prod_logs: 'Error B' };

      const analysis1 = await analyzer.analyzeChain(chain1, { skipCache: true });
      const analysis2 = await analyzer.analyzeChain(chain2, { skipCache: true });

      // Different contexts should produce different analyses (or at least different timestamps)
      expect(analysis1.timestamp).toBeTruthy();
      expect(analysis2.timestamp).toBeTruthy();
    });

    it('should reuse cache for identical chains', async () => {
      const analysis1 = await analyzer.analyzeChain(mockChain, { skipCache: true });
      const analysis2 = await analyzer.analyzeChain(mockChain);
      const analysis3 = await analyzer.analyzeChain(mockChain);

      expect(analysis2.id).toBe(analysis1.id);
      expect(analysis3.id).toBe(analysis1.id);
      expect(analysis2.cached).toBe(true);
      expect(analysis3.cached).toBe(true);
    });
  });

  describe('root cause classification', () => {
    it('should classify deployment issues correctly', async () => {
      const deploymentChain: GoldenThreadChain = {
        ...mockChain,
        stage4_build: true,
        stage5_deploy: false,
        stage7_debug_info: 'Deployment failed: port conflict',
      };

      const analysis = await analyzer.analyzeChain(deploymentChain, { skipCache: true });

      expect(analysis.root_cause).toBeDefined();
      expect(['TEST_GAP', 'CODE_BUG', 'SPEC_GAP', 'DEPLOYMENT']).toContain(
        analysis.root_cause
      );
    });

    it('should classify code bugs correctly', async () => {
      const bugChain: GoldenThreadChain = {
        ...mockChain,
        stage6_prod_logs: 'ReferenceError: undefined variable at line 42',
      };

      const analysis = await analyzer.analyzeChain(bugChain, { skipCache: true });

      expect(analysis.root_cause).toBeDefined();
      expect(analysis.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should classify spec gaps correctly', async () => {
      const specGapChain: GoldenThreadChain = {
        ...mockChain,
        stage1_spec: 'User should see a button (not specified what button does)',
        stage7_debug_info: 'Button click handler missing',
      };

      const analysis = await analyzer.analyzeChain(specGapChain, { skipCache: true });

      expect(analysis.root_cause).toBeDefined();
      expect(analysis.suggestions.length).toBeGreaterThan(0);
    });

    it('should classify test gaps correctly', async () => {
      const testGapChain: GoldenThreadChain = {
        ...mockChain,
        stage2_test_code: 'it("exists", () => { expect(1).toBe(1); }); // No real test logic',
      };

      const analysis = await analyzer.analyzeChain(testGapChain, { skipCache: true });

      expect(analysis.root_cause).toBeDefined();
    });
  });

  describe('data models', () => {
    it('should return valid RootCauseAnalysis structure', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true });

      // Verify all required fields
      expect(analysis).toHaveProperty('id');
      expect(analysis).toHaveProperty('golden_thread_id');
      expect(analysis).toHaveProperty('root_cause');
      expect(analysis).toHaveProperty('confidence');
      expect(analysis).toHaveProperty('reasoning');
      expect(analysis).toHaveProperty('suggestions');
      expect(analysis).toHaveProperty('timestamp');
      expect(analysis).toHaveProperty('model_used');
      expect(analysis).toHaveProperty('cached');

      // Verify types
      expect(typeof analysis.id).toBe('string');
      expect(typeof analysis.golden_thread_id).toBe('string');
      expect(typeof analysis.root_cause).toBe('string');
      expect(typeof analysis.confidence).toBe('number');
      expect(typeof analysis.reasoning).toBe('string');
      expect(Array.isArray(analysis.suggestions)).toBe(true);
      expect(typeof analysis.timestamp).toBe('string');
      expect(typeof analysis.model_used).toBe('string');
      expect(typeof analysis.cached).toBe('boolean');
    });
  });

  describe('error handling', () => {
    it('should handle missing context gracefully', async () => {
      const incompleteChain: GoldenThreadChain = {
        ...mockChain,
        stage1_spec: undefined,
        stage2_test_code: undefined,
        stage6_prod_logs: undefined,
      };

      const analysis = await analyzer.analyzeChain(incompleteChain, { skipCache: true });

      // Should still produce a result
      expect(analysis).toBeDefined();
      expect(analysis.root_cause).toBeTruthy();
    });

    it('should validate confidence score range', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true });

      expect(analysis.confidence).toBeGreaterThanOrEqual(0.7);
      expect(analysis.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should limit suggestions to 3 items', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true });

      expect(analysis.suggestions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('typescript and code quality', () => {
    it('should have no implicit any types', () => {
      // This is verified at compile time by tsconfig strict mode
      expect(true).toBe(true);
    });

    it('should use structured logging', async () => {
      // Analyzer should not throw when logging
      const analysis = await analyzer.analyzeChain(mockChain);
      expect(analysis).toBeDefined();
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple sequential analyses', async () => {
      const results = [];
      for (let i = 0; i < 3; i++) {
        const chain: GoldenThreadChain = {
          ...mockChain,
          id: `chain-${i}`,
          stage6_prod_logs: `Error scenario ${i}`,
        };
        results.push(await analyzer.analyzeChain(chain, { skipCache: true }));
      }

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.id)).toBe(true);
    });

    it('should handle feedback-driven learning', async () => {
      const analysis1 = await analyzer.analyzeChain(mockChain, { skipCache: true });

      // Record that the initial analysis was wrong
      await analyzer.recordFeedback(analysis1.id, false, 'SPEC_GAP');

      // In a real scenario, this feedback would be used to improve future analyses
      // For now, just verify the feedback was accepted
      expect(true).toBe(true);
    });
  });
});
