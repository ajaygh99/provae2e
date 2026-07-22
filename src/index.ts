/**
 * PROVA public entry point
 * Re-exports the pieces of the platform meant for programmatic use.
 * The CLI itself lives in src/cli/run.ts.
 */
export { log } from './core/logger.js';
export { fetchJiraTicketDescription, jiraDescriptionToText, syncJiraTestStatus } from './core/jira-connector.js';
export type {
  JiraConnectorOptions, JiraDescriptionResult, JiraStatusSyncOptions, JiraStatusSyncResult, JiraTestStatus
} from './core/jira-connector.js';
export { buildJiraAuthorizationUrl, exchangeJiraAuthorizationCode, refreshJiraAccessToken } from './core/jira-oauth.js';
export type { JiraOAuthClient, JiraOAuthTokens } from './core/jira-oauth.js';
export { parseJiraEnvironments, resolveJiraEnvironment } from './core/jira-environments.js';
export type { JiraEnvironment, JiraEnvironments } from './core/jira-environments.js';
export { generateTestData, generateTestDataFromFile } from './core/test-data-factory.js';
export type { TestDataFactoryOptions, TestDataFactoryResult } from './core/test-data-factory.js';
export { extractFigmaElements, fetchFigmaElements } from './core/figma-connector.js';
export type { FigmaConnectorOptions, FigmaElement, FigmaElementsResult } from './core/figma-connector.js';
export { createK6Script, parseK6Summary, runK6 } from './core/k6-runner.js';
export type { K6CommandExecutor, K6Metrics, K6RunOptions, K6RunResult } from './core/k6-runner.js';
export { comparePerformanceMetrics, loadPerformanceBaseline, savePerformanceBaseline } from './core/performance-baseline.js';
export { executeWithRetry } from './core/retry-handler.js';
export type { RetryOptions } from './core/retry-handler.js';
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
export { generateAdvancedTestData, generateAdvancedTestDataFromFile, serializeTestData } from './generators/test-data-factory.js';
export type { AdvancedDataOptions, AdvancedDataResult, DataFormat } from './generators/test-data-factory.js';
export { generateAiSpec } from './generators/ai-spec-generator.js';
export type { AiSpecOptions, AiSpecResult } from './generators/ai-spec-generator.js';
export { parseGherkin } from './parsers/gherkin-parser.js';
export type { AcceptanceLanguage, ParsedFeature, ParsedScenario, ParsedStep, StepKind } from './parsers/gherkin-parser.js';
export { stepToPlaywright } from './mappers/step-to-playwright.js';
export { PerformanceStore } from './perf/performance-store.js';
export type { PerformanceRun, StoredPerformanceMetrics } from './perf/performance-store.js';
export { detectRegressions, hasDegradingTrend, performanceRunsToCsv } from './perf/regression-detector.js';
export type { PerformanceRegression } from './perf/regression-detector.js';
export { FigmaCredentialStore } from './storage/figma-credentials.js';
export type { FigmaCredentials } from './storage/figma-credentials.js';
export { generateFigmaTests } from './generators/figma-test-generator.js';
export { SpecLinkStore } from './core/spec-link-store.js';
export type { Requirement, RequirementTest, RequirementCoverage } from './core/spec-link-store.js';
export {
  createSpecLinks,
  validateSpecLinks,
  linkTest,
  getRequirementsCoverage,
  extendTestMetadata
} from './core/spec-linker.js';
export type {
  SpecLinkOptions,
  SpecLinkCreateResult,
  SpecLinkValidationOptions,
  SpecLinkValidation,
  LinkTestOptions,
  LinkTestResult
} from './core/spec-linker.js';
export { GoldenThreadStore } from './core/golden-thread-store.js';
export type { Stage, StageStatus, DeploymentStatus, StageLog, GoldenThreadChain } from './core/golden-thread-store.js';
export { GoldenThreadLinker } from './core/golden-thread-linker.js';
export type { LinkStageOptions, InitiateChainOptions } from './core/golden-thread-linker.js';
export { initiateFromJira } from './core/golden-thread-jira.js';
export type { JiraSpecOptions } from './core/golden-thread-jira.js';
export { linkGitHubBuildAndDeploy } from './core/golden-thread-github.js';
export type { GitHubBuildDeployOptions } from './core/golden-thread-github.js';
export { linkDatadogStage } from './core/golden-thread-datadog.js';
export type { DatadogStageOptions } from './core/golden-thread-datadog.js';
export { generateHtmlReport, generateJsonReport } from './reporters/golden-thread-reporter.js';
export type { ReportOptions } from './reporters/golden-thread-reporter.js';
export { renderCommitTraceHtml, renderCommitTraceJson } from './reporters/golden-thread-commit-reporter.js';
export { GitHubApiClient } from './core/github-api-client.js';
export type { GitHubWorkflowRun, GitHubDeployment, GitHubCommit } from './core/github-api-client.js';
