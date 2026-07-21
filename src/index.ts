/**
 * PROVA public entry point
 * Re-exports the pieces of the platform meant for programmatic use.
 * The CLI itself lives in src/cli/run.ts.
 */
export { log } from './core/logger.js';
export { fetchJiraTicketDescription, jiraDescriptionToText } from './core/jira-connector.js';
export type { JiraConnectorOptions, JiraDescriptionResult } from './core/jira-connector.js';
export { generateTestData, generateTestDataFromFile } from './core/test-data-factory.js';
export type { TestDataFactoryOptions, TestDataFactoryResult } from './core/test-data-factory.js';
export { extractFigmaElements, fetchFigmaElements } from './core/figma-connector.js';
export type { FigmaConnectorOptions, FigmaElement, FigmaElementsResult } from './core/figma-connector.js';
export { createK6Script, parseK6Summary, runK6 } from './core/k6-runner.js';
export type { K6CommandExecutor, K6Metrics, K6RunOptions, K6RunResult } from './core/k6-runner.js';
export { comparePerformanceMetrics, loadPerformanceBaseline, savePerformanceBaseline } from './core/performance-baseline.js';
export {
  parseHeaders,
  validateApiPayload,
  validateDevice,
  validateHeaders,
  validateHttpUrl,
  validatePositiveInteger,
  validateRunType,
  validateWorkers
} from './core/input-validator.js';
export type { HttpHeaders } from './core/input-validator.js';
export { extractAcceptanceCriteria, generateTestsFromSpec } from './generators/spec-test-generator.js';
export type {
  GeneratedTestType,
  GenerateTestsOptions,
  GenerateTestsResult
} from './generators/spec-test-generator.js';
