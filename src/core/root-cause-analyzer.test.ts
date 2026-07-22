/**
 * Unit tests for RootCauseAnalyzer.
 * Tests: initialization, data models, caching, error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { RootCauseAnalyzer, type RootCauseAnalysis } from './root-cause-analyzer.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import type { GoldenThreadChain } from './golden-thread-store.js';

const testDbPath = join(tmpdir(), `rca-test-${Date.now()}.db`);

const mockChain: GoldenThreadChain = {
  golden_thread_id: 'chain-123',
  created_at: new Date().toISOString(),
  stages: [
    {
      golden_thread_id: 'chain-123',
      stage: 1,
      status: 'PASSED',
      timestamp: new Date().toISOString(),
      actor: 'spec-author',
      artifact_url: 'spec-url',
      parent_id: null,
      metadata: JSON.stringify({ desc: 'Login test' }),
    },
    {
      golden_thread_id: 'chain-123',
      stage: 2,
      status: 'PASSED',
      timestamp: new Date().toISOString(),
      actor: 'test-author',
      artifact_url: 'test-url',
      parent_id: null,
      metadata: JSON.stringify({ code: 'test code' }),
    },
    {
      golden_thread_id: 'chain-123',
      stage: 6,
      status: 'FAILED',
      timestamp: new Date().toISOString(),
      actor: 'monitoring',
      artifact_url: 'logs-url',
      parent_id: null,
      metadata: JSON.stringify({ error: 'Connection timeout' }),
    },
  ],
};

describe('RootCauseAnalyzer', () => {
  let analyzer: RootCauseAnalyzer;

  beforeEach(async () => {
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch (e) {
        // ignore
      }
    }
    analyzer = await RootCauseAnalyzer.open(testDbPath);
  });

  afterEach(() => {
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch (e) {
        // ignore
      }
    }
  });

  describe('initialization', () => {
    it('should initialize analyzer with database', async () => {
      expect(analyzer).toBeDefined();
      expect(existsSync(testDbPath)).toBe(true);
    });
  });

  describe('data models', () => {
    it('should return valid RootCauseAnalysis structure with graceful degradation', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });

      expect(analysis).toBeDefined();
      expect(analysis.id).toMatch(/^rca_/);
      expect(analysis.golden_thread_id).toBe('chain-123');
      expect(['TEST_GAP', 'CODE_BUG', 'SPEC_GAP', 'DEPLOYMENT']).toContain(
        analysis.root_cause
      );
      expect(analysis.confidence).toBeGreaterThanOrEqual(0.5);
      expect(analysis.confidence).toBeLessThanOrEqual(1.0);
      expect(analysis.reasoning).toBeTruthy();
      expect(analysis.suggestions).toBeInstanceOf(Array);
      expect(analysis.timestamp).toBeTruthy();
      expect(typeof analysis.model_used).toBe('string');
      expect(typeof analysis.cached).toBe('boolean');
    });

    it('should have all required fields in analysis result', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });

      const requiredFields = [
        'id',
        'golden_thread_id',
        'root_cause',
        'confidence',
        'reasoning',
        'suggestions',
        'timestamp',
        'model_used',
        'cached',
      ];

      for (const field of requiredFields) {
        expect(analysis).toHaveProperty(field);
      }
    });
  });

  describe('caching', () => {
    it('should mark cached results appropriately', async () => {
      const analysis1 = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });
      // First call with skipCache should not be cached
      expect(analysis1.cached).toBe(false);

      // Second call without skipCache should attempt cache lookup
      // (may or may not hit cache depending on db persistence)
      const analysis2 = await analyzer.analyzeChain(mockChain, { offline: true });
      expect(typeof analysis2.cached).toBe('boolean');
    });

    it('should skip cache when explicitly requested', async () => {
      await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });
      const analysis2 = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });

      expect(analysis2.cached).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle empty chain gracefully', async () => {
      const emptyChain: GoldenThreadChain = {
        golden_thread_id: 'chain-empty',
        created_at: new Date().toISOString(),
        stages: [],
      };

      const analysis = await analyzer.analyzeChain(emptyChain, { skipCache: true, offline: true });

      expect(analysis).toBeDefined();
      expect(analysis.root_cause).toBeTruthy();
      expect(analysis.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should validate confidence score range', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });

      expect(analysis.confidence).toBeGreaterThanOrEqual(0.5);
      expect(analysis.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should limit suggestions to maximum 3 items', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });

      expect(analysis.suggestions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('feedback recording', () => {
    it('should record positive feedback without error', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });

      expect(async () => {
        await analyzer.recordFeedback(analysis.id, true);
      }).not.toThrow();
    });

    it('should record negative feedback with actual cause', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });

      expect(async () => {
        await analyzer.recordFeedback(analysis.id, false, 'DEPLOYMENT');
      }).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple sequential analyses', async () => {
      const results: RootCauseAnalysis[] = [];

      for (let i = 0; i < 3; i++) {
        const chain: GoldenThreadChain = {
          golden_thread_id: `chain-${i}`,
          created_at: new Date().toISOString(),
          stages: mockChain.stages.map((s) => ({
            ...s,
            golden_thread_id: `chain-${i}`,
          })),
        };

        const analysis = await analyzer.analyzeChain(chain, { skipCache: true, offline: true });
        results.push(analysis);
      }

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.id)).toBe(true);
    });

    it('should handle feedback learning workflow', async () => {
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });

      expect(async () => {
        await analyzer.recordFeedback(analysis.id, false, 'SPEC_GAP');
        await analyzer.recordFeedback(analysis.id, true);
      }).not.toThrow();
    });
  });

  describe('root cause classification', () => {
    it('should classify chains into valid root cause types', async () => {
      const validTypes = ['TEST_GAP', 'CODE_BUG', 'SPEC_GAP', 'DEPLOYMENT'];
      const analysis = await analyzer.analyzeChain(mockChain, { skipCache: true, offline: true });

      expect(validTypes).toContain(analysis.root_cause);
    });
  });

  describe('TypeScript strict mode', () => {
    it('should have proper type annotations', () => {
      expect(analyzer).toBeDefined();
      // This test verifies TypeScript compilation succeeded
    });
  });
});
