/** Golden Thread Stage 7 (Debug) - Root cause analysis and production issue classification. */
import { GoldenThreadLinker } from './golden-thread-linker.js';
import { ProductionLogsStore } from './production-logs-store.js';
import { type StageLog } from './golden-thread-store.js';

/** Root cause classification type. */
export type DebugClassification = 'TestGap' | 'CodeBug' | 'SpecGap' | 'DeploymentIssue';

/** Production error extracted from logs. */
export interface ProductionError {
  message: string;
  level: 'ERROR' | 'WARNING';
  first_occurrence: string;
  last_occurrence: string;
  occurrence_count: number;
  affected_service: string;
}

/** Previous incident record. */
export interface PreviousIncident {
  golden_thread_id: string;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  fixed_in_commit?: string;
}

/** Complete root cause analysis result. */
export interface RootCauseAnalysis {
  golden_thread_id: string;
  prod_error: ProductionError;
  was_tested: boolean;
  test_evidence_link: string | null;
  ci_run_link: string | null;
  code_change_link: string | null;
  issue_history: PreviousIncident[];
  classification: DebugClassification;
  diagnostic_summary: string;
  confidence: number;
}

/** Options for analyzing root cause of a production issue. */
export interface RootCauseOptions {
  golden_thread_id: string;
  linker: GoldenThreadLinker;
  logs_store: ProductionLogsStore;
  error_signature: string;
}

/** Options for linking Stage 7 to a chain. */
export interface DebugStageOptions {
  golden_thread_id: string;
  linker: GoldenThreadLinker;
  logs_store: ProductionLogsStore;
}

/**
 * Performs root cause analysis on a production incident by tracing it backward
 * through the 7-stage Golden Thread chain. Answers key diagnostic questions and
 * classifies the root cause.
 * @param opts Root cause analysis options
 * @returns Comprehensive root cause analysis with classification
 */
export async function analyzeRootCause(opts: RootCauseOptions): Promise<RootCauseAnalysis> {
  const { golden_thread_id, linker, error_signature } = opts;

  const chain = await linker.getChain(golden_thread_id);
  if (!chain) throw new Error(`Golden Thread ${golden_thread_id} not found`);

  const stage6 = chain.stages.find(s => s.stage === 6);
  const stage3 = chain.stages.find(s => s.stage === 3);
  const stage4 = chain.stages.find(s => s.stage === 4);

  const prodError = extractProductionError(stage6, error_signature);
  const wasTested = checkTestCoverage(stage3, error_signature);
  const testEvidenceLink = wasTested ? stage3?.artifact_url ?? null : null;
  const ciRunLink = extractCiRunLink(stage3);
  const codeChangeLink = extractCodeChangeLink(stage4);
  const issueHistory = await findRecurringPatterns(golden_thread_id, linker);

  const classification = classifyIncident({
    golden_thread_id,
    prod_error: prodError,
    was_tested: wasTested,
    test_evidence_link: testEvidenceLink,
    ci_run_link: ciRunLink,
    code_change_link: codeChangeLink,
    issue_history: issueHistory,
    diagnostic_summary: '',
    confidence: 0
  });

  const diagnosticSummary = generateDiagnosticSummary(
    classification,
    wasTested,
    issueHistory.length > 0
  );

  const confidence = calculateConfidence(wasTested, classification, issueHistory.length);

  return {
    golden_thread_id,
    prod_error: prodError,
    was_tested: wasTested,
    test_evidence_link: testEvidenceLink,
    ci_run_link: ciRunLink,
    code_change_link: codeChangeLink,
    issue_history: issueHistory,
    classification,
    diagnostic_summary: diagnosticSummary,
    confidence
  };
}

/**
 * Classifies the root cause of an incident based on diagnostic analysis.
 * @param analysis Partial analysis with diagnostic data
 * @returns Classification: TestGap, CodeBug, SpecGap, or DeploymentIssue
 */
export function classifyIncident(analysis: Partial<RootCauseAnalysis>): DebugClassification {
  const { was_tested, issue_history } = analysis;

  if (!was_tested) {
    const hasHistory = (issue_history?.length ?? 0) > 0;
    if (hasHistory) {
      const wasFixed = issue_history?.some(h => h.fixed_in_commit);
      return wasFixed ? 'CodeBug' : 'TestGap';
    }
    return 'TestGap';
  }

  if ((issue_history?.length ?? 0) > 0) {
    const recurring = (issue_history ?? []).some(h => h.occurrence_count > 1);
    return recurring ? 'CodeBug' : 'DeploymentIssue';
  }

  return 'CodeBug';
}

/**
 * Detects recurring patterns by finding previous incidents with similar error signatures.
 * @param golden_thread_id Current chain ID
 * @param linker Golden Thread linker
 * @returns Array of previous incidents
 */
export async function findRecurringPatterns(
  golden_thread_id: string,
  linker: GoldenThreadLinker
): Promise<PreviousIncident[]> {
  try {
    const allChains = await linker.listChains();
    const previousIncidents: PreviousIncident[] = [];

    for (const chainId of allChains) {
      if (chainId === golden_thread_id) continue;

      const chain = await linker.getChain(chainId);
      if (!chain) continue;

      const stage6 = chain.stages.find(s => s.stage === 6);
      if (!stage6 || !stage6.metadata) continue;

      try {
        const metadata = JSON.parse(stage6.metadata) as Record<string, unknown>;
        const errorCount = metadata.error_count as number | undefined;
        if (errorCount && errorCount > 0) {
          previousIncidents.push({
            golden_thread_id: chainId,
            first_seen: stage6.timestamp,
            last_seen: stage6.timestamp,
            occurrence_count: errorCount,
            fixed_in_commit: undefined
          });
        }
      } catch {
        // Metadata parsing failed, skip this chain
      }
    }

    return previousIncidents.slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Extracts the primary production error from Stage 6 logs.
 * @param stage6 Stage 6 (Monitor) log
 * @param error_signature Error message pattern to match
 * @returns Extracted production error details
 */
function extractProductionError(stage6: StageLog | undefined, error_signature: string): ProductionError {
  if (!stage6 || !stage6.metadata) {
    return {
      message: error_signature,
      level: 'ERROR',
      first_occurrence: stage6?.timestamp ?? new Date().toISOString(),
      last_occurrence: stage6?.timestamp ?? new Date().toISOString(),
      occurrence_count: 1,
      affected_service: 'unknown'
    };
  }

  try {
    const metadata = JSON.parse(stage6.metadata) as Record<string, unknown>;
    return {
      message: error_signature,
      level: metadata.error_count ? 'ERROR' : 'WARNING',
      first_occurrence: stage6.timestamp,
      last_occurrence: stage6.timestamp,
      occurrence_count: (metadata.error_count as number) || 1,
      affected_service: (metadata.service_name as string) || 'unknown'
    };
  } catch {
    return {
      message: error_signature,
      level: 'ERROR',
      first_occurrence: stage6.timestamp,
      last_occurrence: stage6.timestamp,
      occurrence_count: 1,
      affected_service: 'unknown'
    };
  }
}

/**
 * Checks whether the production error was covered by test evidence (Stage 3).
 * @param stage3 Stage 3 (Evidence) log
 * @param error_signature Error message pattern
 * @returns True if error was found in test evidence
 */
function checkTestCoverage(stage3: StageLog | undefined, error_signature: string): boolean {
  if (!stage3 || !stage3.metadata) return false;

  try {
    const metadata = JSON.parse(stage3.metadata) as Record<string, unknown>;
    const errors = (metadata.errors || []) as string[];
    return errors.some(e => e.toLowerCase().includes(error_signature.toLowerCase()));
  } catch {
    return false;
  }
}

/**
 * Extracts CI run link from test evidence (Stage 3) metadata.
 * @param stage3 Stage 3 (Evidence) log
 * @returns Link to CI run, or null if not found
 */
function extractCiRunLink(stage3: StageLog | undefined): string | null {
  if (!stage3 || !stage3.metadata) return null;

  try {
    const metadata = JSON.parse(stage3.metadata) as Record<string, unknown>;
    return (metadata.ci_run_url as string) || null;
  } catch {
    return null;
  }
}

/**
 * Extracts code change link from build stage (Stage 4) metadata.
 * @param stage4 Stage 4 (Build) log
 * @returns Link to code change (commit diff), or null if not found
 */
function extractCodeChangeLink(stage4: StageLog | undefined): string | null {
  if (!stage4 || !stage4.metadata) return null;

  try {
    const metadata = JSON.parse(stage4.metadata) as Record<string, unknown>;
    return (metadata.commit_url as string) || null;
  } catch {
    return null;
  }
}

/**
 * Generates a human-readable diagnostic summary based on classification.
 * @param classification Root cause classification
 * @param wasTested Whether the error scenario was tested
 * @param hasHistory Whether previous incidents exist
 * @returns Diagnostic summary string
 */
function generateDiagnosticSummary(
  classification: DebugClassification,
  wasTested: boolean,
  hasHistory: boolean
): string {
  switch (classification) {
    case 'TestGap':
      return `This error was not covered by test cases. No test evidence found in Stage 3. ${hasHistory ? 'This issue has occurred before and needs a test case to prevent regression.' : 'Add a test case to cover this scenario.'}`;
    case 'CodeBug':
      return `The code introduced this bug. ${wasTested ? 'Test was created but failed in production, indicating a bug in the implementation.' : 'Test coverage exists but the code has a bug.'} Check Stage 4 (Build) for the responsible commit.`;
    case 'SpecGap':
      return `The specification does not cover this scenario. The system behavior is not defined in the requirements (Stage 1). Define expected behavior in the spec and create a test.`;
    case 'DeploymentIssue':
      return `This issue is related to deployment or infrastructure, not test or code gaps. Check Stage 5 (Deploy) for deployment logs and infrastructure configuration.`;
    default:
      return 'Root cause could not be determined. Please review all stages manually.';
  }
}

/**
 * Calculates confidence score for the root cause analysis (0-100).
 * @param wasTested Whether error was tested
 * @param classification Root cause classification
 * @param historyCount Number of previous incidents
 * @returns Confidence score
 */
function calculateConfidence(
  wasTested: boolean,
  classification: DebugClassification,
  historyCount: number
): number {
  let score = 50;

  if (wasTested) score += 15;
  if (historyCount > 0) score += 20;

  switch (classification) {
    case 'TestGap':
      score += 10;
      break;
    case 'CodeBug':
      score += 15;
      break;
    case 'DeploymentIssue':
      score += 5;
      break;
    default:
      score += 0;
  }

  return Math.min(100, score);
}

/**
 * Links Stage 7 (Debug) to a Golden Thread chain with root cause analysis.
 * @param opts Stage linking options
 */
export async function linkDebugStage(opts: DebugStageOptions): Promise<void> {
  const { golden_thread_id, linker, logs_store } = opts;

  const chain = await linker.getChain(golden_thread_id);
  if (!chain) throw new Error(`Golden Thread ${golden_thread_id} not found`);

  const stage6 = chain.stages.find(s => s.stage === 6);
  if (!stage6) throw new Error(`Golden Thread ${golden_thread_id} missing Stage 6 (Monitor)`);

  let errorSignature = 'unknown-error';
  try {
    const stage6Metadata = JSON.parse(stage6.metadata) as Record<string, unknown>;
    const errorCount = stage6Metadata.error_count as number;
    if (errorCount && errorCount > 0) {
      errorSignature = `Production error with ${errorCount} occurrences`;
    }
  } catch {
    // Metadata parsing failed, use default signature
  }

  const analysis = await analyzeRootCause({
    golden_thread_id,
    linker,
    logs_store,
    error_signature: errorSignature
  });

  const artifact_url = `https://dashboard.example.com/debug/${golden_thread_id}`;

  await linker.linkStage({
    golden_thread_id,
    stage: 7,
    status: 'PASSED',
    actor: 'debug-analyzer',
    artifact_url,
    metadata: {
      stage_name: 'Debug',
      classification: analysis.classification,
      was_tested: analysis.was_tested,
      confidence: analysis.confidence,
      diagnostic_summary: analysis.diagnostic_summary,
      issue_history_count: analysis.issue_history.length,
      error_message: analysis.prod_error.message,
      error_occurrence_count: analysis.prod_error.occurrence_count
    }
  });
}
