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
export { getMetricsSummary, calculateStageDurations, calculateStagePassRate, getCommonFailureStages } from './reporters/dashboard-metrics.js';
export type { DashboardMetrics, StageDuration, StageFailure } from './core/dashboard-types.js';
export { filterChains, enrichChainWithDuration, toChainSummary } from './reporters/dashboard-aggregator.js';
export type { DashboardFilter, ChainSummary } from './core/dashboard-types.js';
export { generateDashboardHtml } from './reporters/dashboard-generator.js';
export { generatePdfReportHtml } from './reporters/dashboard-pdf-export.js';
export { dashboardCommand } from './cli/dashboard.js';
export type { DashboardOptions } from './cli/dashboard.js';
export {
  ContractRegistry,
  detectProductionDrift,
  generateComplianceReport,
  parseOpenApiContract,
  parsePactContract,
  validateApiExchange
} from './core/contract-testing.js';
export { TestDataLineageTracker, validateTestData } from './core/test-data-lineage.js';
export type {
  DataEnvironment,
  DatabaseImpact,
  DatabaseImpactInput,
  DataValidationWarning,
  LineageEdge,
  LineageNode,
  RegisterTestDataInput,
  TestDataCleaner,
  TestDataCleanupResult,
  TestDataIsolationReport,
  TestDataLifecycle,
  TestDataLineageGraph,
  TestDataRecord,
  TestDataSource
} from './core/test-data-lineage.js';
export { analyzeRegressionTrend, calculateMetricBaseline } from './core/regression-trend-analyzer.js';
export type {
  MetricAssessment,
  MetricBaseline,
  RegressionJiraCreator,
  RegressionJiraIssue,
  RegressionJiraResult,
  RegressionTrendOptions,
  RegressionTrendReport,
  StageTiming,
  TrendMetricName,
  TrendMetrics,
  TrendRun
} from './core/regression-trend-analyzer.js';
export { IncidentPatternRecognizer, incidentSignature, textSimilarity } from './core/incident-pattern-recognizer.js';
export type {
  HistoricalIncident,
  IncidentMatch,
  IncidentPattern,
  IncidentPatternMetrics,
  IncidentPatternReport,
  IncidentRootCause
} from './core/incident-pattern-recognizer.js';
export { SENTINEL_RESOURCE_BUDGET, SentinelAgent, shouldSample } from './core/sentinel-agent.js';
export type {
  SentinelAgentOptions,
  SentinelCoverage,
  SentinelCoverageMatcher,
  SentinelEvidence,
  SentinelJiraCreator,
  SentinelJiraIssue,
  SentinelJiraResult,
  SentinelProcessResult
} from './core/sentinel-agent.js';
export { SentinelPatternRecognizer, detectSpike, extractSentinelPattern } from './core/sentinel-pattern-recognizer.js';
export type {
  SentinelGapReport,
  SentinelPatternCoverage,
  SentinelPatternCoverageMatcher,
  SentinelPatternEvent,
  SentinelPatternOptions,
  SentinelPatternSignature,
  SentinelPatternSummary
} from './core/sentinel-pattern-recognizer.js';
export { SentinelDependencyMonitor, classifyCvss, parseNpmLock, parsePom, parseRequirements } from './core/sentinel-dependency-monitor.js';
export type {
  CveMatch,
  CveProvider,
  CveSeverity,
  DependencyAlert,
  DependencyEcosystem,
  DependencyFinding,
  DependencyMonitorOptions,
  DependencyNotifier,
  DependencyPollResult,
  ProductionDependency,
  Soc2CveReport
} from './core/sentinel-dependency-monitor.js';
export { SentinelErrorBudgetTracker, monthlyBudgetMs, parseSlaConfig } from './core/sentinel-error-budget.js';
export type {
  DowntimeEvent,
  ErrorBudgetAlert,
  ErrorBudgetComplianceReport,
  ErrorBudgetStatus,
  ServiceSlaConfig,
  SlaTarget
} from './core/sentinel-error-budget.js';
export {
  SentinelUserImpactAssessor,
  impactAlert,
  preventionRecommendation
} from './core/sentinel-user-impact.js';
export type {
  IncidentImpactAssessment,
  IncidentImpactInput,
  QuarterlyImpactReport,
  UserTrace
} from './core/sentinel-user-impact.js';
export {
  SentinelRemediationEngine,
  parseRemediationRules
} from './core/sentinel-remediation.js';
export type {
  ActionExecutionResult,
  RemediationAction,
  RemediationActionType,
  RemediationAuditEntry,
  RemediationExecutor,
  RemediationObservation,
  RemediationRule,
  RemediationRun,
  TriggerOperator
} from './core/sentinel-remediation.js';
export {
  SentinelCostOptimizer,
  recommendation
} from './core/sentinel-cost-optimizer.js';
export type {
  CloudCostCollector,
  CloudCostRecord,
  CloudProvider,
  CostOpportunity,
  CostOptimizerOptions,
  CostRecommendation,
  MonthlyCostReport,
  ResourceKind,
  ServiceCostTrend
} from './core/sentinel-cost-optimizer.js';
export {
  SentinelForecastingEngine,
  linearTrend
} from './core/sentinel-forecasting.js';
export type {
  ForecastAccuracy,
  ForecastActionExecutor,
  ForecastActionResult,
  ForecastDirection,
  ForecastFeedback,
  ForecastHorizonHours,
  ForecastPoint,
  ForecastRule,
  ForecastRun,
  MetricForecast
} from './core/sentinel-forecasting.js';
export type {
  ApiExchange,
  ComplianceReport,
  ContractDriftAlert,
  ContractFetch,
  ContractOperation,
  ContractSource,
  ContractValidationResult,
  DriftNotifier,
  JsonSchema,
  RegisteredContract
} from './core/contract-testing.js';
