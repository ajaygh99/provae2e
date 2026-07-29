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
export { normalizeFigmaNodeId, parseFigmaReference } from './core/figma-reference.js';
export type { FigmaReference, FigmaReferenceResult } from './core/figma-reference.js';
export { createK6Script, parseK6Summary, runK6 } from './core/k6-runner.js';
export type { K6CommandExecutor, K6Metrics, K6RunOptions, K6RunResult } from './core/k6-runner.js';
export { comparePerformanceMetrics, loadPerformanceBaseline, savePerformanceBaseline } from './core/performance-baseline.js';
export { executeWithRetry } from './core/retry-handler.js';
export type { RetryOptions } from './core/retry-handler.js';
export { normalizeCloudParallel } from './core/device-cloud-provider.js';
export { BrowserStackConnector } from './core/browserstack-connector.js';
export type { BrowserStackConnectorClients } from './core/browserstack-connector.js';
export type {
  CloudDevice,
  DeviceCloudConfig,
  DeviceCloudProvider,
  DeviceCloudTest,
  DeviceCloudTestResult,
  DeviceSession,
  DeviceSessionArtifacts,
  MobileOperatingSystem
} from './core/device-cloud-provider.js';
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
export { TestStepCanvas } from './studio/test-step-canvas.js';
export type {
  CanvasDropLocation,
  CanvasDropOutcome,
  CanvasDropResult,
  NewStudioTestStep,
  StudioTestStep,
  TestStepAction,
  TestStepCanvasOptions,
  TestStepCanvasSnapshot
} from './studio/test-step-canvas.js';
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
export { AnalyticsStore } from './storage/analytics-store.js';
export type {
  Anomaly, FlakyTest, RunQuery, TestRunRecord, TestRunStatus, TestRunType, TrendData
} from './storage/analytics-store.js';
export { SQLiteAnalyticsStore } from './storage/sqlite-analytics-store.js';
export { PostgresAnalyticsStore } from './storage/postgres-analytics-store.js';
export type { PostgresClient } from './storage/postgres-analytics-store.js';
export { AnalyticsReporter } from './reporters/analytics-reporter.js';
export type { AnalyticsReport } from './reporters/analytics-reporter.js';
export { PowerBIExporter } from './exporters/powerbi-exporter.js';
export type { PowerBIConfig, PowerBIExportResult } from './exporters/powerbi-exporter.js';
export { generateFigmaTests } from './generators/figma-test-generator.js';
export type { FigmaTestGenerationOptions } from './generators/figma-test-generator.js';
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
export { SentinelMultiCloudMonitor } from './core/sentinel-multicloud.js';
export type {
  CloudCompliance,
  CloudConnector,
  CloudDashboard,
  CloudIncident,
  CloudMetric,
  CloudScenarioCoverage,
  ComplianceFramework,
  CrossCloudFinding,
  InfrastructureCloud
} from './core/sentinel-multicloud.js';
export {
  AndroidAdbMetricCollector,
  AppiumPerformanceMonitor,
  analyzeSamples,
  parseAndroidBattery,
  parseAndroidCpu,
  parseAndroidFps,
  parseAndroidMemoryMb
} from './core/appium-performance-monitor.js';
export type {
  DeviceMetricCollector,
  DevicePerformanceRun,
  DevicePerformanceSample,
  MonitorOptions,
  PerformanceAlert,
  PerformanceThresholds
} from './core/appium-performance-monitor.js';
export { ZapFalsePositiveFilter, parseZapFilterRules, zapFindingKey } from './core/zap-false-positive-filter.js';
export type {
  FilterAction,
  FilteredZapFinding,
  FindingDisposition,
  FindingWhitelist,
  ZapAccuracyPoint,
  ZapFilterRule,
  ZapFinding as ZapFilterFinding,
  ZapRisk,
  ZapScanResult
} from './core/zap-false-positive-filter.js';
export { SentinelAnalyticsEngine } from './core/sentinel-analytics.js';
export type {
  AnalyticsIncident,
  AnalyticsModelVersion,
  AnalyticsOptions,
  IncidentAnalysis,
  IncidentCluster,
  IncidentRecommendation
} from './core/sentinel-analytics.js';
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
export { KnowledgeGraphIntegration } from './core/knowledge-graph-integration.js';
export type {
  CoverageSuggestion,
  GraphNodeType,
  GraphQueryResult,
  KnowledgeGraphDataset,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  TestHistory
} from './core/knowledge-graph-integration.js';
export { graphCommand } from './cli/graph.js';
export { exampleFromSchema, generateOpenApiTests, runOpenApiContract } from './core/openapi-runner.js';
export type {
  OpenApiGenerateOptions,
  OpenApiOperationResult,
  OpenApiRunOptions
} from './core/openapi-runner.js';
export { HealingMemoryStore } from './core/healing-memory.js';
export type { HealingRecommendation } from './core/healing-memory.js';
export { resolveSelector, SelectorResolutionError } from './core/self-healing-selector.js';
export type {
  ResolvedSelector, SelectorDescriptor, SelectorLearningOptions, SelectorTier
} from './core/self-healing-selector.js';
export { AiBudgetGuard, DEFAULT_AI_BUDGET } from './core/ai-budget.js';
export type { AiBudget, AiUsage } from './core/ai-budget.js';
export { containsSensitiveData, redactSensitiveData } from './core/sensitive-data.js';
export { rankSelectorCandidates, tokenSimilarity } from './core/adaptive-selector.js';
export type { RankedSelectorCandidate, SelectorCandidateSummary } from './core/adaptive-selector.js';
export { resolveSelectorWithOllama } from './core/ollama-selector-resolver.js';
export type { OllamaSelectorOptions } from './core/ollama-selector-resolver.js';
export {
  clearSelectorRepairProposals,
  createSelectorRepairProposal,
  listSelectorRepairProposals,
  reviewSelectorRepairProposal,
  writeSelectorRepairProposal
} from './core/selector-repair-proposal.js';
export type { SelectorRepairProposal } from './core/selector-repair-proposal.js';
export type { GraphCommandOptions } from './cli/graph.js';
export { buildZapCoverageDashboard, classifyZapFindings } from './core/zap-vulnerability-classifier.js';
export type {
  OwaspCategory,
  OwaspCategoryCoverage,
  SecurityTestSource,
  VulnerabilityClassification,
  ZapCoverageDashboard,
  ZapFinding
} from './core/zap-vulnerability-classifier.js';
export {
  GraphQueryCache,
  KnowledgeGraphQueryApi,
  KnowledgeGraphQueryEngine
} from './core/knowledge-graph-query.js';
export type {
  BusinessQuestion,
  GraphAggregateQuery,
  GraphEdge,
  GraphPath,
  GraphQueryRequest,
  GraphQueryResponse,
  GraphVertex,
  GraphVertexType
} from './core/knowledge-graph-query.js';
export { KnowledgeGraphInsightEngine } from './core/knowledge-graph-insights.js';
export type {
  GraphCodeChange,
  GraphIncident,
  GraphTest,
  InsightImpact,
  InsightOptions,
  InsightType,
  KnowledgeGraphInsight,
  KnowledgeSubgraph
} from './core/knowledge-graph-insights.js';
export { StudioRunService } from './studio/studio-run-service.js';
export type {
  StudioCommandRunner,
  StudioSpawnRequest,
  StudioSpawnResult
} from './studio/studio-run-service.js';
export {
  createStudioHttpServer,
  listenStudioLoopback
} from './studio/studio-http-server.js';
