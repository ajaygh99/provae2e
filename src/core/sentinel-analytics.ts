/** ML-inspired incident clustering, anomaly detection, and explainable recommendations. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface AnalyticsIncident {
  id: string;
  occurredAt: string;
  service: string;
  summary: string;
  metrics?: Record<string, number>;
  severity: 1 | 2 | 3 | 4 | 5;
  resolution?: string;
  outcome?: 'resolved' | 'mitigated' | 'unresolved';
}

export interface IncidentCluster {
  id: string;
  incidentIds: string[];
  services: string[];
  topTerms: string[];
}

export interface IncidentRecommendation {
  action: string;
  similarIncidentId: string;
  similarity: number;
  explanation: string;
}

export interface IncidentAnalysis {
  clusterId?: string;
  anomaly: boolean;
  anomalyScore: number;
  priorityScore: number;
  recommendation?: IncidentRecommendation;
  explanation: string;
}

export interface AnalyticsModelVersion {
  version: string;
  trainedAt: string;
  incidentCount: number;
  clusterCount: number;
  silhouetteScore: number;
}

interface StoredModel {
  versions: AnalyticsModelVersion[];
  incidents: AnalyticsIncident[];
  clusters: IncidentCluster[];
  lastTrainedAt?: string;
}

export interface AnalyticsOptions {
  now?: () => Date;
  similarityThreshold?: number;
  anomalyThreshold?: number;
  retentionDays?: number;
}

/** Persistent Sentinel incident analytics engine. */
export class SentinelAnalyticsEngine {
  private constructor(
    private readonly filePath: string,
    private readonly state: StoredModel,
    private readonly now: () => Date,
    private readonly similarityThreshold: number,
    private readonly anomalyThreshold: number,
    private readonly retentionDays: number
  ) {}

  /**
   * Opens a versioned analytics model.
   * @param filePath JSON model storage path.
   * @param options Clock and model thresholds.
   * @returns Initialized analytics engine.
   */
  static async open(filePath: string, options: AnalyticsOptions = {}): Promise<SentinelAnalyticsEngine> {
    const similarityThreshold = bounded(options.similarityThreshold ?? 0.3, 'similarityThreshold');
    const anomalyThreshold = bounded(options.anomalyThreshold ?? 0.75, 'anomalyThreshold');
    const retentionDays = options.retentionDays ?? 183;
    if (!Number.isInteger(retentionDays) || retentionDays <= 0) throw new Error('retentionDays must be a positive integer');
    let state: StoredModel = { versions: [], incidents: [], clusters: [] };
    try {
      state = JSON.parse(await readFile(filePath, 'utf8')) as StoredModel;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return new SentinelAnalyticsEngine(
      path.resolve(filePath), state, options.now ?? (() : Date => new Date()),
      similarityThreshold, anomalyThreshold, retentionDays
    );
  }

  /**
   * Adds incidents and retrains when no model exists or a week has elapsed.
   * @param incidents Historical or newly observed incidents.
   * @returns A new model version when training occurred.
   */
  async learn(incidents: AnalyticsIncident[]): Promise<AnalyticsModelVersion | undefined> {
    incidents.forEach(validateIncident);
    const byId = new Map(this.state.incidents.map(item => [item.id, item]));
    incidents.forEach(item => byId.set(item.id, structuredClone(item)));
    const cutoff = this.currentTime() - this.retentionDays * 86_400_000;
    this.state.incidents = [...byId.values()].filter(item => Date.parse(item.occurredAt) >= cutoff);
    const due = this.state.lastTrainedAt === undefined
      || this.currentTime() - Date.parse(this.state.lastTrainedAt) >= 7 * 86_400_000;
    if (!due) {
      await this.persist();
      return undefined;
    }
    this.state.clusters = cluster(this.state.incidents, this.similarityThreshold);
    const trainedAt = new Date(this.currentTime()).toISOString();
    const version: AnalyticsModelVersion = {
      version: `${trainedAt}-v${this.state.versions.length + 1}`,
      trainedAt,
      incidentCount: this.state.incidents.length,
      clusterCount: this.state.clusters.length,
      silhouetteScore: silhouette(this.state.incidents, this.state.clusters)
    };
    this.state.versions.push(version);
    this.state.lastTrainedAt = trainedAt;
    await this.persist();
    return version;
  }

  /**
   * Scores a new incident and explains its nearest cluster and resolution.
   * @param incident Incident to evaluate.
   * @returns Novelty, priority, and optional remediation recommendation.
   */
  analyze(incident: AnalyticsIncident): IncidentAnalysis {
    validateIncident(incident);
    const similarities = this.state.incidents.map(item => ({ item, score: similarity(incident, item) }))
      .sort((left, right) => right.score - left.score);
    const nearest = similarities[0];
    const anomalyScore = round(1 - (nearest?.score ?? 0));
    const anomaly = anomalyScore >= this.anomalyThreshold;
    const clusterId = nearest
      ? this.state.clusters.find(item => item.incidentIds.includes(nearest.item.id))?.id
      : undefined;
    const metricRisk = Math.min(1, Object.values(incident.metrics ?? {}).filter(value => value > 0).length / 5);
    const priorityScore = round((incident.severity / 5) * 70 + anomalyScore * 20 + metricRisk * 10);
    const resolved = similarities.find(item => item.item.resolution?.trim() && item.item.outcome !== 'unresolved');
    const recommendation = resolved?.item.resolution ? {
      action: resolved.item.resolution,
      similarIncidentId: resolved.item.id,
      similarity: round(resolved.score),
      explanation: `Based on ${similarities.filter(item => item.score >= this.similarityThreshold).length} similar incidents; ${relativeAge(resolved.item.occurredAt, this.currentTime())}.`
    } : undefined;
    return {
      ...(clusterId ? { clusterId } : {}),
      anomaly,
      anomalyScore,
      priorityScore,
      ...(recommendation ? { recommendation } : {}),
      explanation: anomaly
        ? `Novel incident: nearest historical similarity is ${round((nearest?.score ?? 0) * 100)}%.`
        : `Matched ${clusterId ?? 'historical incidents'} using service, text, metrics, and timing features.`
    };
  }

  /** @returns Current clusters. */
  clusters(): IncidentCluster[] {
    return structuredClone(this.state.clusters);
  }

  /** @returns Model version and performance history. */
  versions(): AnalyticsModelVersion[] {
    return structuredClone(this.state.versions);
  }

  private currentTime(): number {
    const value = this.now().getTime();
    if (!Number.isFinite(value)) throw new Error('Current time must be valid');
    return value;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }
}

function cluster(incidents: AnalyticsIncident[], threshold: number): IncidentCluster[] {
  const groups: AnalyticsIncident[][] = [];
  for (const incident of incidents) {
    const match = groups.find(group => similarity(incident, group[0]) >= threshold);
    if (match) match.push(incident);
    else groups.push([incident]);
  }
  return groups.map((group, index) => ({
    id: `cluster-${index + 1}`,
    incidentIds: group.map(item => item.id),
    services: [...new Set(group.map(item => item.service))].sort(),
    topTerms: topTerms(group.flatMap(item => tokens(item.summary)))
  }));
}

function similarity(left: AnalyticsIncident, right: AnalyticsIncident): number {
  const a = new Set(tokens(left.summary));
  const b = new Set(tokens(right.summary));
  const union = new Set([...a, ...b]).size;
  const text = union === 0 ? 0 : [...a].filter(token => b.has(token)).length / union;
  const service = left.service.toLowerCase() === right.service.toLowerCase() ? 1 : 0;
  const hourA = new Date(left.occurredAt).getUTCHours();
  const hourB = new Date(right.occurredAt).getUTCHours();
  const timing = 1 - Math.min(Math.abs(hourA - hourB), 24 - Math.abs(hourA - hourB)) / 12;
  const keys = [...new Set([...Object.keys(left.metrics ?? {}), ...Object.keys(right.metrics ?? {})])];
  const metrics = keys.length === 0 ? 0 : keys.filter(key => key in (left.metrics ?? {}) && key in (right.metrics ?? {})).length / keys.length;
  return round(text * 0.55 + service * 0.25 + metrics * 0.15 + timing * 0.05);
}

function silhouette(incidents: AnalyticsIncident[], clusters: IncidentCluster[]): number {
  if (incidents.length < 2 || clusters.length < 2) return 0;
  const scores = incidents.map(incident => {
    const own = clusters.find(item => item.incidentIds.includes(incident.id));
    const same = incidents.filter(item => own?.incidentIds.includes(item.id) && item.id !== incident.id);
    const a = same.length ? average(same.map(item => 1 - similarity(incident, item))) : 0;
    const otherDistances = clusters.filter(item => item.id !== own?.id).map(group =>
      average(incidents.filter(item => group.incidentIds.includes(item.id)).map(item => 1 - similarity(incident, item)))
    );
    const b = Math.min(...otherDistances);
    return Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b);
  });
  return round(average(scores));
}

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
}

function topTerms(values: string[]): string[] {
  const counts = new Map<string, number>();
  values.forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(item => item[0]);
}

function relativeAge(occurredAt: string, now: number): string {
  const weeks = Math.max(0, Math.round((now - Date.parse(occurredAt)) / (7 * 86_400_000)));
  return `similar incident ${weeks} week${weeks === 1 ? '' : 's'} ago`;
}

function validateIncident(incident: AnalyticsIncident): void {
  if (!incident.id.trim()) throw new Error('incident.id is required');
  if (!incident.service.trim()) throw new Error('incident.service is required');
  if (!incident.summary.trim()) throw new Error('incident.summary is required');
  if (!Number.isFinite(Date.parse(incident.occurredAt))) throw new Error('incident.occurredAt must be valid');
  if (![1, 2, 3, 4, 5].includes(incident.severity)) throw new Error('incident.severity must be between 1 and 5');
  Object.values(incident.metrics ?? {}).forEach(value => {
    if (!Number.isFinite(value)) throw new Error('incident metrics must be finite');
  });
}

function bounded(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  return value;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
