/** Orchestrates requirement-to-test linking from JIRA specs. */
import { SpecLinkStore, type RequirementCoverage } from './spec-link-store.js';
import { extractAcceptanceCriteria } from '../generators/spec-test-generator.js';

/** Options for creating spec links. */
export interface SpecLinkOptions {
  /** JIRA issue key, e.g., PROJ-123. */
  jiraIssueKey: string;
  /** Full spec text from JIRA description. */
  specText: string;
  /** Path to spec link database. */
  databasePath: string;
}

/** Result of creating spec links from requirements. */
export interface SpecLinkResult {
  ok: true;
  jiraIssueKey: string;
  requirementCount: number;
  requirementTexts: string[];
  database: string;
}

/** Failure result. */
export type SpecLinkCreateResult = SpecLinkResult | { ok: false; error: string };

/** Options for validating spec links. */
export interface SpecLinkValidationOptions {
  /** JIRA issue key. */
  jiraIssueKey: string;
  /** Path to spec link database. */
  databasePath: string;
}

/** Validation result showing coverage summary. */
export interface SpecLinkValidation {
  ok: true;
  jiraIssueKey: string;
  totalRequirements: number;
  coveredRequirements: number;
  coveragePercentage: number;
  uncoveredRequirements: string[];
}

/** Failure validation result. */
export type SpecLinkValidationResult = SpecLinkValidation | { ok: false; error: string };

/** Options for linking a test to requirements. */
export interface LinkTestOptions {
  /** Test ID to link. */
  testId: string;
  /** Test name for human reference. */
  testName: string;
  /** JIRA issue key that contains the requirement. */
  jiraIssueKey: string;
  /** Requirement order (1-based) to link to. */
  requirementOrder?: number;
  /** Stable acceptance-criteria ID accepted by Studio/API clients. */
  acceptCriteriaId?: number;
  /** Test status. */
  testStatus?: 'PASSED' | 'FAILED' | 'PENDING';
  /** Path to spec link database. */
  databasePath: string;
}

/** Result of linking a test. */
export type LinkTestResult =
  | { ok: true; testId: string; jiraIssueKey: string; requirementOrder: number; acceptCriteriaId: number }
  | { ok: false; error: string };

/**
 * Creates spec links by parsing requirements from spec text and storing them.
 *
 * @param options - JIRA key, spec text, and database path.
 * @returns Created requirements or a failure message.
 */
export async function createSpecLinks(options: SpecLinkOptions): Promise<SpecLinkCreateResult> {
  try {
    if (!options.jiraIssueKey.trim()) {
      return { ok: false, error: 'JIRA issue key is required' };
    }
    if (!options.specText.trim()) {
      return { ok: false, error: 'Spec text is empty' };
    }

    const store = await SpecLinkStore.open(options.databasePath);
    const requirements = extractAcceptanceCriteria(options.specText);

    if (requirements.length === 0) {
      return { ok: false, error: 'No acceptance criteria found in spec text' };
    }

    for (let index = 0; index < requirements.length; index++) {
      await store.createRequirement(options.jiraIssueKey, requirements[index], index + 1);
    }

    return {
      ok: true,
      jiraIssueKey: options.jiraIssueKey,
      requirementCount: requirements.length,
      requirementTexts: requirements,
      database: options.databasePath
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to create spec links: ${message}` };
  }
}

/**
 * Validates that a JIRA issue's requirements have test coverage.
 *
 * @param options - JIRA key and database path.
 * @returns Coverage summary or a failure message.
 */
export async function validateSpecLinks(options: SpecLinkValidationOptions): Promise<SpecLinkValidationResult> {
  try {
    if (!options.jiraIssueKey.trim()) {
      return { ok: false, error: 'JIRA issue key is required' };
    }

    const store = await SpecLinkStore.open(options.databasePath);
    const validation = await store.validateCoverage(options.jiraIssueKey);

    return {
      ok: true,
      jiraIssueKey: options.jiraIssueKey,
      totalRequirements: validation.total,
      coveredRequirements: validation.covered,
      coveragePercentage: validation.total > 0 ? Math.round((validation.covered / validation.total) * 100) : 0,
      uncoveredRequirements: validation.uncovered
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to validate spec links: ${message}` };
  }
}

/**
 * Links a test case to a specific requirement.
 *
 * @param options - Test info and JIRA key.
 * @returns Success or failure.
 */
export async function linkTest(options: LinkTestOptions): Promise<LinkTestResult> {
  try {
    if (!options.testId.trim()) {
      return { ok: false, error: 'Test ID is required' };
    }
    if (!options.testName.trim()) {
      return { ok: false, error: 'Test name is required' };
    }
    if (!options.jiraIssueKey.trim()) {
      return { ok: false, error: 'JIRA issue key is required' };
    }
    if (options.requirementOrder === undefined && options.acceptCriteriaId === undefined) {
      return { ok: false, error: 'requirementOrder or acceptCriteriaId is required' };
    }
    if (options.requirementOrder !== undefined && options.requirementOrder < 1) {
      return { ok: false, error: 'Requirement order must be >= 1' };
    }
    if (options.acceptCriteriaId !== undefined && options.acceptCriteriaId < 1) {
      return { ok: false, error: 'Acceptance criteria ID must be >= 1' };
    }

    const store = await SpecLinkStore.open(options.databasePath);
    const requirements = await store.getRequirements(options.jiraIssueKey);
    const requirement = options.acceptCriteriaId !== undefined
      ? requirements.find((candidate) => candidate.id === options.acceptCriteriaId)
      : requirements.find((candidate) => candidate.requirement_order === options.requirementOrder);

    if (!requirement) {
      return {
        ok: false,
        error: `Acceptance criterion not found for ${options.jiraIssueKey}`
      };
    }

    if (requirement.id === undefined) {
      return { ok: false, error: 'Requirement ID is undefined' };
    }

    await store.linkTestToRequirement(requirement.id, options.testId, options.testName, options.testStatus);

    return {
      ok: true,
      testId: options.testId,
      jiraIssueKey: options.jiraIssueKey,
      requirementOrder: requirement.requirement_order,
      acceptCriteriaId: requirement.id
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to link test: ${message}` };
  }
}

/**
 * Retrieves coverage information for all requirements in a JIRA issue.
 *
 * @param jiraIssueKey - JIRA issue key.
 * @param databasePath - Path to spec link database.
 * @returns Array of coverage information per requirement.
 */
export async function getRequirementsCoverage(jiraIssueKey: string, databasePath: string): Promise<RequirementCoverage[]> {
  const store = await SpecLinkStore.open(databasePath);
  return store.getRequirementCoverage(jiraIssueKey);
}

/**
 * Extends test metadata with JIRA requirement information.
 *
 * @param testId - Test ID.
 * @param databasePath - Path to spec link database.
 * @param baseMetadata - Additional metadata to include.
 * @returns Extended metadata object.
 */
export async function extendTestMetadata(
  testId: string,
  databasePath: string,
  baseMetadata?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const store = await SpecLinkStore.open(databasePath);
  return store.extendTestMetadata(testId, baseMetadata);
}
