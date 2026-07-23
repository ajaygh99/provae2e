/** Explainable AI-ready recommendations derived from knowledge-graph subgraphs. */

export type InsightType =
  | 'test-gap' | 'risk' | 'flaky-test' | 'incident'
  | 'optimization' | 'collaboration';
export type InsightImpact = 'low' | 'medium' | 'high' | 'critical';

export interface GraphCodeChange {
  id: string;
  service: string;
  files: string[];
  author: string;
  changedAt: string;
  coveredByTestIds: string[];
  deploymentFailed?: boolean;
}

export interface GraphTest {
  id: string;
  name: string;
  service: string;
  runs: number;
  failures: number;
  durationSeconds: number;
  coveredFiles: string[];
}

export interface GraphIncident {
  id: string;
  service: string;
  occurredAt: string;
  summary: string;
  mitigation: string;
}

export interface KnowledgeSubgraph {
  changes: GraphCodeChange[];
  tests: GraphTest[];
  incidents: GraphIncident[];
}

export interface KnowledgeGraphInsight {
  id: string;
  type: InsightType;
  title: string;
  recommendation: string;
  confidence: number;
  impact: InsightImpact;
  reasoning: string;
  evidenceIds: string[];
  service: string;
}

export interface InsightOptions {
  flakyRate?: number;
  highRiskFailureRate?: number;
  slowTestSeconds?: number;
  incidentSimilarity?: number;
  now?: () => Date;
}

/** Generates explainable, dashboard-ready insights from a relevant knowledge subgraph. */
export class KnowledgeGraphInsightEngine {
  private readonly flakyRate: number;
  private readonly highRiskFailureRate: number;
  private readonly slowTestSeconds: number;
  private readonly incidentSimilarity: number;
  private readonly now: () => Date;

  /**
   * Creates an insight engine.
   * @param options Trend thresholds and clock.
   */
  constructor(options: InsightOptions = {}) {
    this.flakyRate = rate(options.flakyRate ?? 0.01, 'flakyRate');
    this.highRiskFailureRate = rate(options.highRiskFailureRate ?? 0.05, 'highRiskFailureRate');
    this.slowTestSeconds = positive(options.slowTestSeconds ?? 120, 'slowTestSeconds');
    this.incidentSimilarity = rate(options.incidentSimilarity ?? 0.25, 'incidentSimilarity');
    this.now = options.now ?? (() : Date => new Date());
  }

  /**
   * Analyzes graph history for gaps, trends, incidents, optimization, and collaborators.
   * @param graph Relevant knowledge-graph subgraph.
   * @returns Insights sorted by confidence or impact.
   */
  analyze(graph: KnowledgeSubgraph): KnowledgeGraphInsight[] {
    validateGraph(graph);
    const now = this.currentTime();
    const insights = [
      ...this.testGapInsights(graph),
      ...this.riskInsights(graph),
      ...this.flakyInsights(graph),
      ...this.incidentInsights(graph, now),
      ...this.optimizationInsights(graph),
      ...this.collaborationInsights(graph)
    ];
    return this.sort(insights, 'confidence');
  }

  /**
   * Sorts insights for the Studio AI Insights panel.
   * @param insights Insights to order.
   * @param by Confidence or business impact.
   * @returns A sorted copy.
   */
  sort(insights: KnowledgeGraphInsight[], by: 'confidence' | 'impact'): KnowledgeGraphInsight[] {
    const impactRank: Record<InsightImpact, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    return [...insights].sort((left, right) =>
      by === 'confidence'
        ? right.confidence - left.confidence || impactRank[right.impact] - impactRank[left.impact]
        : impactRank[right.impact] - impactRank[left.impact] || right.confidence - left.confidence
    );
  }

  private testGapInsights(graph: KnowledgeSubgraph): KnowledgeGraphInsight[] {
    return graph.changes.filter(change => change.coveredByTestIds.length === 0).map(change =>
      insight('test-gap', change.id, change.service, 'high', 0.95,
        `Code in ${change.files.join(', ')} was not tested`,
        `Add a regression test for ${change.service} covering ${change.files.join(', ')}`,
        [change.id], `No test node covers ${change.files.length} changed file(s).`)
    );
  }

  private riskInsights(graph: KnowledgeSubgraph): KnowledgeGraphInsight[] {
    const services = [...new Set(graph.changes.map(change => change.service))];
    return services.flatMap(service => {
      const changes = graph.changes.filter(change => change.service === service);
      const failures = changes.filter(change => change.deploymentFailed).length;
      const failureRate = changes.length === 0 ? 0 : failures / changes.length;
      if (failureRate < this.highRiskFailureRate) return [];
      return [insight('risk', service, service, failureRate >= 0.2 ? 'critical' : 'high',
        confidence(failureRate, changes.length),
        `${service} changes have ${formatPercent(failureRate)} failure rate`,
        `Require expanded tests and review before deploying ${service}`,
        changes.map(change => change.id),
        `${failures} of ${changes.length} historical changes failed deployment.`)];
    });
  }

  private flakyInsights(graph: KnowledgeSubgraph): KnowledgeGraphInsight[] {
    return graph.tests.flatMap(test => {
      const failureRate = test.runs === 0 ? 0 : test.failures / test.runs;
      if (failureRate < this.flakyRate || failureRate >= 0.5) return [];
      return [insight('flaky-test', test.id, test.service, failureRate >= 0.1 ? 'high' : 'medium',
        confidence(failureRate, test.runs),
        `${test.name} fails ${formatPercent(failureRate)} of runs and is likely flaky`,
        `Investigate isolation, timing, and test data for ${test.name}`,
        [test.id], `${test.failures} intermittent failures across ${test.runs} runs.`)];
    });
  }

  private incidentInsights(graph: KnowledgeSubgraph, now: number): KnowledgeGraphInsight[] {
    return graph.changes.flatMap(change => {
      const text = `${change.service} ${change.files.join(' ')}`;
      const matches = graph.incidents.map(incident => ({ incident, score: similarity(text, `${incident.service} ${incident.summary}`) }))
        .filter(match => match.score >= this.incidentSimilarity)
        .sort((left, right) => right.score - left.score);
      const best = matches[0];
      if (!best) return [];
      return [insight('incident', `${change.id}-${best.incident.id}`, change.service, 'high',
        Math.max(0.5, round(best.score)),
        `Pattern resembles incident ${relativeMonths(best.incident.occurredAt, now)}`,
        best.incident.mitigation,
        [change.id, best.incident.id],
        `Service and change terms are ${formatPercent(best.score)} similar to ${best.incident.id}.`)];
    });
  }

  private optimizationInsights(graph: KnowledgeSubgraph): KnowledgeGraphInsight[] {
    return graph.tests.flatMap(test => {
      if (test.durationSeconds < this.slowTestSeconds) return [];
      const faster = graph.tests.filter(candidate =>
        candidate.id !== test.id && candidate.service === test.service
        && candidate.durationSeconds < test.durationSeconds / 2
        && overlap(candidate.coveredFiles, test.coveredFiles)
      ).sort((left, right) => left.durationSeconds - right.durationSeconds)[0];
      if (!faster) return [];
      return [insight('optimization', test.id, test.service, 'medium', 0.9,
        `${test.name} is slow (${test.durationSeconds}s); ${faster.name} takes ${faster.durationSeconds}s`,
        `Refactor ${test.name} using the setup and scope of ${faster.name}`,
        [test.id, faster.id], `Both tests cover overlapping files in ${test.service}.`)];
    });
  }

  private collaborationInsights(graph: KnowledgeSubgraph): KnowledgeGraphInsight[] {
    const latest = new Map<string, GraphCodeChange>();
    graph.changes.forEach(change => {
      const existing = latest.get(change.service);
      if (!existing || Date.parse(change.changedAt) > Date.parse(existing.changedAt)) latest.set(change.service, change);
    });
    return [...latest.values()].map(change => insight(
      'collaboration', change.id, change.service, 'low', 0.85,
      `${change.author} recently changed ${change.service}`,
      `Contact ${change.author} for review of ${change.service} changes`,
      [change.id], `${change.author} is the most recent contributor in the subgraph.`
    ));
  }

  private currentTime(): number {
    const value = this.now().getTime();
    if (!Number.isFinite(value)) throw new Error('Current time must be valid');
    return value;
  }
}

function insight(
  type: InsightType, suffix: string, service: string, impact: InsightImpact,
  score: number, title: string, recommendation: string, evidenceIds: string[], reasoning: string
): KnowledgeGraphInsight {
  return {
    id: `${type}:${suffix}`, type, title, recommendation,
    confidence: Math.max(0.5, Math.min(1, round(score))),
    impact, reasoning, evidenceIds, service
  };
}

function validateGraph(graph: KnowledgeSubgraph): void {
  graph.changes.forEach(change => {
    required(change.id, 'change.id'); required(change.service, 'change.service');
    required(change.author, 'change.author'); validDate(change.changedAt, 'change.changedAt');
    if (change.files.length === 0) throw new Error('change.files must not be empty');
  });
  graph.tests.forEach(test => {
    required(test.id, 'test.id'); required(test.name, 'test.name'); required(test.service, 'test.service');
    nonNegativeInteger(test.runs, 'test.runs'); nonNegativeInteger(test.failures, 'test.failures');
    if (test.failures > test.runs) throw new Error('test.failures must not exceed test.runs');
    if (!Number.isFinite(test.durationSeconds) || test.durationSeconds < 0) throw new Error('test.durationSeconds must be non-negative');
  });
  graph.incidents.forEach(incident => {
    required(incident.id, 'incident.id'); required(incident.service, 'incident.service');
    required(incident.summary, 'incident.summary'); required(incident.mitigation, 'incident.mitigation');
    validDate(incident.occurredAt, 'incident.occurredAt');
  });
}

function similarity(left: string, right: string): number {
  const a = new Set(tokens(left)); const b = new Set(tokens(right));
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : [...a].filter(value => b.has(value)).length / union;
}
function tokens(value: string): string[] { return value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []; }
function overlap(left: string[], right: string[]): boolean { return left.some(file => right.includes(file)); }
function confidence(rateValue: number, samples: number): number { return 0.5 + Math.min(0.3, rateValue) + Math.min(0.2, samples / 100); }
function formatPercent(value: number): string { return `${round(value * 100)}%`; }
function relativeMonths(occurredAt: string, now: number): string {
  const months = Math.max(0, Math.round((now - Date.parse(occurredAt)) / (30 * 86_400_000)));
  return `from ${months} month${months === 1 ? '' : 's'} ago`;
}
function required(value: string, name: string): void { if (!value.trim()) throw new Error(`${name} is required`); }
function validDate(value: string, name: string): void { if (!Number.isFinite(Date.parse(value))) throw new Error(`${name} must be valid`); }
function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}
function rate(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  return value;
}
function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}
function round(value: number): number { return Number(value.toFixed(4)); }
