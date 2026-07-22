# ARIA Plan for Issue #152

## Issue
Golden Thread: Auto-Root-Cause Analysis (ML/AI)

## Objective
Implement AI-powered root cause analysis for complete 7-stage Golden Thread chains that:
- Analyzes full context (spec, test code, test result, prod logs, error)
- Classifies root cause into: Test Gap | Code Bug | Spec Gap | Deployment
- Provides confidence score (0.7-1.0) with reasoning
- Generates actionable suggestions
- Supports learning feedback loop
- Works with both Claude API and local Ollama
- Gracefully degrades if AI unavailable

## Architecture

### Core Component: `src/core/root-cause-analyzer.ts`
- **Class:** `RootCauseAnalyzer`
- **Methods:**
  - `static async open(filePath: string): RootCauseAnalyzer` — Opens/creates SQLite store for analysis cache + feedback
  - `async analyzeChain(chain: GoldenThreadChain, options: AnalysisOptions): Promise<RootCauseAnalysis>` — Main analysis entry point
  - `async recordFeedback(analysisId: string, correct: boolean, actualCause?: string): Promise<void>` — Learning loop
  - `private buildPrompt(chain: GoldenThreadChain): string` — Constructs context for AI

### Data Models
- **RootCauseType:** 'TEST_GAP' | 'CODE_BUG' | 'SPEC_GAP' | 'DEPLOYMENT'
- **RootCauseAnalysis:**
  - `id: string` — UUID for tracking
  - `golden_thread_id: string`
  - `root_cause: RootCauseType`
  - `confidence: number` — 0.7-1.0
  - `reasoning: string` — Why this cause was chosen
  - `suggestions: string[]` — Actionable next steps
  - `timestamp: string`
  - `model_used: string` — 'claude' or 'ollama'
  - `cached: boolean`

### AI Integration
- **Prompt Template:** ~2KB context including:
  - Stage 1 (Spec) excerpt
  - Stage 2 (Test) code snippet
  - Stage 3 (Evidence) artifacts
  - Stage 4-5 (Build/Deploy) status
  - Stage 6 (Monitor) error logs
  - Stage 7 (Debug) info
- **Models:**
  - Default: `claude-3-5-sonnet` (via ANTHROPIC_API_KEY)
  - Fallback: `qwen3:14b` (local Ollama at http://localhost:11434)
- **API:** axios for HTTP calls, @anthropic-ai/sdk for Claude
- **Caching:** Hash chain context, store results in SQLite to avoid re-analysis

### Error Handling & Graceful Degradation
- If AI service unavailable → return `{ ok: false, error }` (non-fatal)
- Structured logging: `log.warn()` for connection failures
- Never blocks or fails the underlying run

## Files to Create
1. `src/core/root-cause-analyzer.ts` — Main analyzer class
2. `src/core/root-cause-analyzer.test.ts` — Unit + integration tests

## Files to Study
- `src/core/golden-thread-store.ts` — 7-stage chain structure
- `src/core/ai-summary.ts` — AI integration pattern
- `src/core/production-logs-store.ts` — Log querying
- `src/core/evidence-store.ts` — Evidence retrieval

## Acceptance Criteria ✓
- [ ] AI prompt receives full 7-stage context
- [ ] Outputs: root cause classification + confidence + reasoning + suggestions
- [ ] Supports both Claude API and local Ollama (--local flag)
- [ ] Caches results to avoid re-analysis
- [ ] Learning feedback loop (mark suggestions right/wrong)
- [ ] Graceful degradation if AI unavailable
- [ ] 80%+ test coverage
- [ ] TypeScript strict, no `any` types
- [ ] All public functions documented
- [ ] Structured logging (log.info/warn/error)

## Implementation Order
1. Define types and interfaces
2. Create SQLite schema for cache + feedback
3. Implement chain context builder
4. Implement Claude API integration
5. Implement Ollama integration
6. Implement caching layer
7. Write unit tests (happy path + error cases)
8. Write integration tests (real chain scenario)
9. Verify 80%+ coverage
10. Update qa/run-results.md

## Estimated Effort
- Implementation: 4-5 hours
- Testing: 2-3 hours
- Total: 6-8 hours → 8 story points ✓

## Done When
- TypeScript compiles (tsc --noEmit)
- ESLint passes (npm run lint)
- All tests pass (npm test)
- Coverage ≥ 80% for new code
- PR ready for LENS review
