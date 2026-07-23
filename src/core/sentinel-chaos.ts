/**
 * Sentinel chaos engineering integration.
 *
 * Proactively tests production resilience by orchestrating controlled failure
 * experiments (latency spike, instance failure, network partition) against
 * chaos tools (Gremlin, Chaos Monkey), then measuring how the system behaves:
 *
 *  - parses/validates chaos experiment definitions (YAML or object) with
 *    failure type, duration, intensity, SLO, and validation checks;
 *  - measures time-to-recovery from a recovery timeline and validates it
 *    against a recovery SLO (MTTR);
 *  - compares expected vs actual behaviour to surface "what broke that
 *    shouldn't have" (unexpected breaks);
 *  - compares error rate during chaos vs normal;
 *  - restricts automated runs to low-traffic scheduling windows;
 *  - feeds results back into test-gap recommendations and a resilience score.
 *
 * The chaos tool itself is reached only through an injected {@link ChaosClient}
 * and an injected {@link ChaosMonitor}, so no live HTTP or side effects occur
 * in any code path exercised by tests. API credentials are resolved from
 * options or the `GREMLIN_API_KEY` environment variable — never hardcoded.
 */
import { log } from './logger.js';
import { parse as parseYaml } from 'yaml';

/** Supported chaos failure scenarios. */
export type ChaosFailureType = 'latency-spike' | 'instance-failure' | 'network-partition';

/** Supported chaos tool providers. */
export type ChaosProvider = 'gremlin' | 'chaos-monkey';

/** All supported failure types, in a stable order. */
export const CHAOS_FAILURE_TYPES: readonly ChaosFailureType[] = Object.freeze([
  'latency-spike',
  'instance-failure',
  'network-partition'
]);

/** All supported chaos providers, in a stable order. */
export const CHAOS_PROVIDERS: readonly ChaosProvider[] = Object.freeze(['gremlin', 'chaos-monkey']);

/** Environment variable that carries the Gremlin API key when not passed explicitly. */
export const GREMLIN_API_KEY_ENV = 'GREMLIN_API_KEY';

/**
 * A single invariant the system is expected to satisfy during an experiment.
 * `expectedToHold: true` means the invariant SHOULD survive the chaos; if it
 * actually breaks, that is an unexpected regression.
 */
export interface ChaosValidationCheck {
  id: string;
  description: string;
  /** Metric or subsystem the check guards (e.g. `checkout-availability`). */
  metric: string;
  /** Whether the invariant is expected to hold throughout the chaos. */
  expectedToHold: boolean;
}

/** A chaos experiment definition. */
export interface ChaosExperiment {
  id: string;
  provider: ChaosProvider;
  failureType: ChaosFailureType;
  /** Target service or infrastructure identifier the attack is scoped to. */
  target: string;
  /** How long the failure is injected, in seconds (> 0). */
  durationSeconds: number;
  /** Severity of the failure, as a fraction in [0, 1]. */
  intensity: number;
  /** Maximum acceptable time-to-recovery after the attack halts, in seconds (> 0). */
  recoverySloSeconds: number;
  /** Invariants compared against observed behaviour. */
  validationChecks: ChaosValidationCheck[];
}

/** Options for resolving a chaos tool credential. */
export interface ChaosCredentialOptions {
  /** Explicit API key; takes precedence over the environment. */
  apiKey?: string;
  /** Environment lookup (defaults to `process.env`); injectable for tests. */
  env?: NodeJS.ProcessEnv;
}

/** A concrete attack request handed to the injected chaos client. */
export interface ChaosAttackRequest {
  provider: ChaosProvider;
  failureType: ChaosFailureType;
  target: string;
  durationSeconds: number;
  intensity: number;
}

/** Opaque handle returned by a chaos client after an attack starts. */
export interface ChaosAttackHandle {
  attackId: string;
}

/** Injected boundary around a chaos tool (Gremlin API / Chaos Monkey). */
export interface ChaosClient {
  provider: ChaosProvider;
  /** Starts a chaos attack and returns a handle used to halt it. */
  inject(request: ChaosAttackRequest): Promise<ChaosAttackHandle>;
  /** Halts a running chaos attack. */
  halt(handle: ChaosAttackHandle): Promise<void>;
}

/** One point on the recovery timeline sampled after the attack is injected. */
export interface RecoverySample {
  timestamp: string;
  /** Whether the system was healthy at this instant. */
  healthy: boolean;
}

/** Observed result of a single validation check. */
export interface ChaosCheckObservation {
  id: string;
  /** Whether the invariant actually held during the chaos. */
  held: boolean;
}

/** Everything the monitor observed during and after an experiment. */
export interface ChaosObservation {
  /** Recovery timeline, chronological (most recent last). */
  recoverySamples: RecoverySample[];
  /** Observed outcome for each validation check. */
  checkObservations: ChaosCheckObservation[];
  /** Error rate (0..1) during normal operation. */
  normalErrorRate: number;
  /** Error rate (0..1) observed during the chaos. */
  chaosErrorRate: number;
}

/** Context passed to the injected monitor for one experiment run. */
export interface ChaosObservationContext {
  experiment: ChaosExperiment;
  handle: ChaosAttackHandle;
  injectedAt: string;
}

/** Injected boundary that observes system behaviour during an experiment. */
export type ChaosMonitor = (context: ChaosObservationContext) => Promise<ChaosObservation>;

/** Time-to-recovery assessment derived from a recovery timeline. */
export interface RecoveryResult {
  recovered: boolean;
  /** Seconds from injection to sustained recovery; null when never recovered. */
  timeToRecoverySeconds: number | null;
  firstHealthyAt: string | null;
}

/** SLO validation of a recovery result. */
export interface SloValidation {
  recoverySloSeconds: number;
  timeToRecoverySeconds: number | null;
  withinSlo: boolean;
}

/** How error rate moved from normal to chaos conditions. */
export interface ErrorRateComparison {
  normalErrorRate: number;
  chaosErrorRate: number;
  /** Absolute increase (chaos - normal). */
  delta: number;
  /** chaos / normal, or Infinity when normal is 0 and chaos is positive. */
  ratio: number;
}

/** Classification of a single check after comparing expected vs actual. */
export type ChaosCheckOutcome =
  | 'held-as-expected'
  | 'unexpected-break'
  | 'expected-break'
  | 'unexpected-resilience';

/** One reconciled expected-vs-actual check result. */
export interface ChaosCheckComparison {
  id: string;
  description: string;
  metric: string;
  expectedToHold: boolean;
  actualHeld: boolean;
  outcome: ChaosCheckOutcome;
}

/** Full expected-vs-actual behaviour comparison. */
export interface BehaviorComparison {
  checks: ChaosCheckComparison[];
  /** IDs of invariants that were expected to hold but broke. */
  unexpectedBreaks: string[];
  /** IDs of invariants that were expected to break and did (chaos worked). */
  expectedBreaks: string[];
  /** True when nothing broke that was expected to hold. */
  cleanResilience: boolean;
}

/** A test-gap recommendation fed back from a chaos result. */
export interface TestGapRecommendation {
  severity: 'high' | 'medium' | 'low';
  category: 'recovery' | 'unexpected-break' | 'error-rate';
  failureType: ChaosFailureType;
  message: string;
}

/** Complete result of running one chaos experiment. */
export interface ChaosExperimentResult {
  experimentId: string;
  provider: ChaosProvider;
  failureType: ChaosFailureType;
  target: string;
  injectedAt: string;
  haltedAt: string;
  recovery: RecoveryResult;
  slo: SloValidation;
  comparison: BehaviorComparison;
  errorRate: ErrorRateComparison;
  gapRecommendations: TestGapRecommendation[];
  /** True when recovery met SLO and nothing unexpected broke. */
  passed: boolean;
  /** Resilience score in [0, 100]; teams get credit for clean chaos passes. */
  score: number;
  summary: string;
}

/** A recurring low-traffic scheduling window expressed in UTC hours. */
export interface LowTrafficWindow {
  /** Inclusive start hour in UTC, 0..23. */
  startHourUtc: number;
  /** Exclusive end hour in UTC, 1..24 (may be <= start for overnight windows). */
  endHourUtc: number;
}

/** Options controlling a full experiment run. */
export interface RunChaosOptions {
  /** Clock injection; defaults to `Date.now`-based ISO timestamps. */
  now?: () => Date;
  /** When set, the run is only allowed inside one of these windows. */
  lowTrafficWindows?: readonly LowTrafficWindow[];
  /** When true, running outside a low-traffic window throws instead of proceeding. */
  requireLowTrafficWindow?: boolean;
}

const MILLIS_PER_SECOND = 1000;
const MILLIS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const MAX_WINDOW_SCAN_HOURS = 24 * 14;

/**
 * Resolves a chaos tool API key from options or the environment.
 * @param options Explicit key and/or an environment source.
 * @returns The resolved, non-empty API key.
 * @throws Error when no key is available from either source.
 */
export function resolveChaosApiKey(options: ChaosCredentialOptions = {}): string {
  const env = options.env ?? process.env;
  const key = options.apiKey ?? env[GREMLIN_API_KEY_ENV];
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error(`Chaos API key is required (pass apiKey or set ${GREMLIN_API_KEY_ENV})`);
  }
  return key.trim();
}

/**
 * Validates a chaos experiment definition, throwing a typed error on bad input.
 * @param experiment Candidate experiment.
 * @throws Error when any field is missing or out of range.
 */
export function validateChaosExperiment(experiment: ChaosExperiment): void {
  requireText(experiment.id, 'experiment.id');
  requireText(experiment.target, 'experiment.target');
  if (!CHAOS_PROVIDERS.includes(experiment.provider)) {
    throw new Error(`Unsupported chaos provider: ${String(experiment.provider)}`);
  }
  if (!CHAOS_FAILURE_TYPES.includes(experiment.failureType)) {
    throw new Error(`Unsupported chaos failure type: ${String(experiment.failureType)}`);
  }
  if (!Number.isFinite(experiment.durationSeconds) || experiment.durationSeconds <= 0) {
    throw new Error('experiment.durationSeconds must be a positive number');
  }
  if (!Number.isFinite(experiment.intensity) || experiment.intensity < 0 || experiment.intensity > 1) {
    throw new Error('experiment.intensity must be between 0 and 1');
  }
  if (!Number.isFinite(experiment.recoverySloSeconds) || experiment.recoverySloSeconds <= 0) {
    throw new Error('experiment.recoverySloSeconds must be a positive number');
  }
  if (!Array.isArray(experiment.validationChecks) || experiment.validationChecks.length === 0) {
    throw new Error('experiment.validationChecks must contain at least one check');
  }
  const ids = new Set<string>();
  for (const check of experiment.validationChecks) {
    requireText(check.id, 'validationCheck.id');
    if (ids.has(check.id)) throw new Error(`Duplicate validation check id: ${check.id}`);
    ids.add(check.id);
    requireText(check.description, 'validationCheck.description');
    requireText(check.metric, 'validationCheck.metric');
    if (typeof check.expectedToHold !== 'boolean') {
      throw new Error('validationCheck.expectedToHold must be a boolean');
    }
  }
}

/**
 * Parses one or more chaos experiments from YAML configuration.
 *
 * Accepts either a single experiment document or a document with an
 * `experiments:` array. Every parsed experiment is validated.
 * @param content YAML source text.
 * @returns The validated experiments.
 * @throws Error when the YAML is invalid or defines no experiments.
 */
export function parseChaosExperiments(content: string): ChaosExperiment[] {
  let document: unknown;
  try {
    document = parseYaml(content);
  } catch {
    throw new Error('Invalid chaos experiment YAML');
  }
  const list = extractExperimentList(document);
  if (list.length === 0) throw new Error('Chaos YAML defines no experiments');
  const experiments = list.map(normalizeExperiment);
  experiments.forEach(validateChaosExperiment);
  return experiments;
}

/**
 * Builds a chaos attack request from a validated experiment.
 * @param experiment The experiment to translate into an attack request.
 * @returns The attack request handed to a chaos client.
 */
export function buildAttackRequest(experiment: ChaosExperiment): ChaosAttackRequest {
  validateChaosExperiment(experiment);
  return {
    provider: experiment.provider,
    failureType: experiment.failureType,
    target: experiment.target,
    durationSeconds: experiment.durationSeconds,
    intensity: experiment.intensity
  };
}

/**
 * Computes time-to-recovery from a recovery timeline.
 *
 * Recovery is the first sample (at or after injection) that is healthy and
 * stays healthy through the end of the timeline. Time-to-recovery is the gap
 * between injection and that sample, in seconds.
 * @param injectedAt ISO timestamp when the attack was injected.
 * @param samples Chronological recovery samples (most recent last).
 * @returns Recovery assessment; `recovered: false` when it never stabilises.
 * @throws Error when timestamps are invalid or the timeline is empty.
 */
export function computeTimeToRecovery(injectedAt: string, samples: readonly RecoverySample[]): RecoveryResult {
  const injectedTime = Date.parse(injectedAt);
  if (!Number.isFinite(injectedTime)) throw new Error(`invalid injectedAt timestamp: ${injectedAt}`);
  if (samples.length === 0) throw new Error('computeTimeToRecovery requires at least one recovery sample');

  const parsed = samples.map((sample) => {
    const time = Date.parse(sample.timestamp);
    if (!Number.isFinite(time)) throw new Error(`invalid recovery sample timestamp: ${sample.timestamp}`);
    if (time < injectedTime) throw new Error('recovery samples must not precede injectedAt');
    if (typeof sample.healthy !== 'boolean') throw new Error('recovery sample healthy must be a boolean');
    return { time, healthy: sample.healthy };
  }).sort((left, right) => left.time - right.time);

  let recoveryIndex = -1;
  for (let index = 0; index < parsed.length; index += 1) {
    if (parsed[index].healthy && parsed.slice(index).every((sample) => sample.healthy)) {
      recoveryIndex = index;
      break;
    }
  }

  if (recoveryIndex === -1) {
    return { recovered: false, timeToRecoverySeconds: null, firstHealthyAt: null };
  }
  const recoveryTime = parsed[recoveryIndex].time;
  return {
    recovered: true,
    timeToRecoverySeconds: (recoveryTime - injectedTime) / MILLIS_PER_SECOND,
    firstHealthyAt: new Date(recoveryTime).toISOString()
  };
}

/**
 * Validates a recovery result against the experiment's recovery SLO.
 *
 * Passes only when the system recovered and did so at or before the SLO
 * (the boundary is inclusive: `timeToRecovery === slo` passes).
 * @param recovery Recovery assessment.
 * @param recoverySloSeconds Maximum acceptable time-to-recovery, in seconds (> 0).
 * @returns SLO validation.
 * @throws Error when the SLO is not a positive number.
 */
export function validateRecoverySlo(recovery: RecoveryResult, recoverySloSeconds: number): SloValidation {
  if (!Number.isFinite(recoverySloSeconds) || recoverySloSeconds <= 0) {
    throw new Error('recoverySloSeconds must be a positive number');
  }
  const withinSlo = recovery.recovered
    && recovery.timeToRecoverySeconds !== null
    && recovery.timeToRecoverySeconds <= recoverySloSeconds;
  return {
    recoverySloSeconds,
    timeToRecoverySeconds: recovery.timeToRecoverySeconds,
    withinSlo
  };
}

/**
 * Reconciles expected validation checks against observed outcomes.
 * @param checks Declared validation checks.
 * @param observations Observed per-check outcomes.
 * @returns The expected-vs-actual comparison, highlighting unexpected breaks.
 * @throws Error when an observation is missing or references an unknown check.
 */
export function compareExpectedVsActual(
  checks: readonly ChaosValidationCheck[],
  observations: readonly ChaosCheckObservation[]
): BehaviorComparison {
  if (checks.length === 0) throw new Error('compareExpectedVsActual requires at least one check');
  const observed = new Map<string, boolean>();
  for (const observation of observations) {
    if (typeof observation.held !== 'boolean') throw new Error('check observation held must be a boolean');
    observed.set(observation.id, observation.held);
  }

  const comparisons: ChaosCheckComparison[] = checks.map((check) => {
    if (!observed.has(check.id)) throw new Error(`missing observation for check: ${check.id}`);
    const actualHeld = observed.get(check.id) as boolean;
    return {
      id: check.id,
      description: check.description,
      metric: check.metric,
      expectedToHold: check.expectedToHold,
      actualHeld,
      outcome: classifyOutcome(check.expectedToHold, actualHeld)
    };
  });

  const unexpectedBreaks = comparisons.filter((c) => c.outcome === 'unexpected-break').map((c) => c.id);
  const expectedBreaks = comparisons.filter((c) => c.outcome === 'expected-break').map((c) => c.id);
  return {
    checks: comparisons,
    unexpectedBreaks,
    expectedBreaks,
    cleanResilience: unexpectedBreaks.length === 0
  };
}

/**
 * Compares error rate during chaos against normal operation.
 * @param normalErrorRate Baseline error rate (0..1).
 * @param chaosErrorRate Error rate observed during chaos (0..1).
 * @returns Absolute delta and ratio of the two error rates.
 * @throws Error when either rate is outside [0, 1].
 */
export function computeErrorRateComparison(normalErrorRate: number, chaosErrorRate: number): ErrorRateComparison {
  assertRate(normalErrorRate, 'normalErrorRate');
  assertRate(chaosErrorRate, 'chaosErrorRate');
  const ratio = normalErrorRate === 0
    ? (chaosErrorRate === 0 ? 1 : Number.POSITIVE_INFINITY)
    : chaosErrorRate / normalErrorRate;
  return {
    normalErrorRate,
    chaosErrorRate,
    delta: chaosErrorRate - normalErrorRate,
    ratio
  };
}

/**
 * Determines whether a timestamp falls inside any low-traffic window (UTC).
 *
 * Windows are half-open `[startHourUtc, endHourUtc)`. A window whose end hour
 * is at or before its start hour is treated as spanning midnight.
 * @param timestamp ISO timestamp to test.
 * @param windows Candidate low-traffic windows.
 * @returns True when the timestamp is inside at least one window.
 * @throws Error when the timestamp or any window is invalid.
 */
export function isWithinLowTrafficWindow(timestamp: string, windows: readonly LowTrafficWindow[]): boolean {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) throw new Error(`invalid timestamp: ${timestamp}`);
  windows.forEach(validateWindow);
  const hour = new Date(time).getUTCHours();
  return windows.some((window) => hourInWindow(hour, window));
}

/**
 * Finds the next instant at or after `from` that falls in a low-traffic window.
 * @param from ISO timestamp to search forward from.
 * @param windows Candidate low-traffic windows.
 * @returns ISO timestamp (aligned to the top of the hour) inside a window.
 * @throws Error when input is invalid or no window is reachable within 14 days.
 */
export function nextLowTrafficWindow(from: string, windows: readonly LowTrafficWindow[]): string {
  const fromTime = Date.parse(from);
  if (!Number.isFinite(fromTime)) throw new Error(`invalid timestamp: ${from}`);
  if (windows.length === 0) throw new Error('nextLowTrafficWindow requires at least one window');
  windows.forEach(validateWindow);

  const start = new Date(fromTime);
  if (isWithinLowTrafficWindow(from, windows)) return from;
  const cursor = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
    start.getUTCHours() + 1
  ));
  for (let scanned = 0; scanned < MAX_WINDOW_SCAN_HOURS; scanned += 1) {
    if (windows.some((window) => hourInWindow(cursor.getUTCHours(), window))) {
      return cursor.toISOString();
    }
    cursor.setTime(cursor.getTime() + MILLIS_PER_HOUR);
  }
  throw new Error('no low-traffic window found within 14 days');
}

/**
 * Derives test-gap recommendations from an experiment's measured behaviour.
 * @param experiment The experiment that was run.
 * @param recovery Recovery assessment.
 * @param slo SLO validation.
 * @param comparison Expected-vs-actual behaviour comparison.
 * @param errorRate Error-rate comparison.
 * @returns Prioritised recommendations to close resilience test gaps.
 */
export function recommendTestGaps(
  experiment: ChaosExperiment,
  recovery: RecoveryResult,
  slo: SloValidation,
  comparison: BehaviorComparison,
  errorRate: ErrorRateComparison
): TestGapRecommendation[] {
  const recommendations: TestGapRecommendation[] = [];
  if (!recovery.recovered) {
    recommendations.push({
      severity: 'high',
      category: 'recovery',
      failureType: experiment.failureType,
      message: `System never recovered from ${experiment.failureType} on ${experiment.target}; add automated recovery/remediation coverage`
    });
  } else if (!slo.withinSlo) {
    recommendations.push({
      severity: 'high',
      category: 'recovery',
      failureType: experiment.failureType,
      message: `Recovery took ${slo.timeToRecoverySeconds}s, exceeding the ${slo.recoverySloSeconds}s SLO; add a time-to-recovery regression test`
    });
  }
  for (const brokenId of comparison.unexpectedBreaks) {
    const check = comparison.checks.find((c) => c.id === brokenId);
    recommendations.push({
      severity: 'high',
      category: 'unexpected-break',
      failureType: experiment.failureType,
      message: `Invariant "${check?.description ?? brokenId}" (${check?.metric ?? brokenId}) broke unexpectedly; add a guarding test`
    });
  }
  if (errorRate.chaosErrorRate > errorRate.normalErrorRate && errorRate.ratio >= 2) {
    recommendations.push({
      severity: errorRate.ratio >= 5 ? 'high' : 'medium',
      category: 'error-rate',
      failureType: experiment.failureType,
      message: `Error rate rose ${formatRatio(errorRate.ratio)}x during chaos (${errorRate.normalErrorRate} -> ${errorRate.chaosErrorRate}); add error-budget assertions`
    });
  }
  return recommendations;
}

/**
 * Scores an experiment's resilience in [0, 100].
 *
 * Starts at 100 and deducts for never recovering, breaching the recovery SLO,
 * unexpected breaks, and error-rate blow-ups. Teams keep full credit when a
 * controlled chaos test recovers within SLO with no unexpected breaks.
 * @param recovery Recovery assessment.
 * @param slo SLO validation.
 * @param comparison Expected-vs-actual comparison.
 * @param errorRate Error-rate comparison.
 * @returns Integer resilience score between 0 and 100.
 */
export function scoreChaosResult(
  recovery: RecoveryResult,
  slo: SloValidation,
  comparison: BehaviorComparison,
  errorRate: ErrorRateComparison
): number {
  let score = 100;
  if (!recovery.recovered) score -= 50;
  else if (!slo.withinSlo) score -= 25;
  score -= Math.min(40, comparison.unexpectedBreaks.length * 20);
  if (Number.isFinite(errorRate.ratio) && errorRate.ratio >= 5) score -= 15;
  else if (errorRate.ratio === Number.POSITIVE_INFINITY) score -= 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Computes the mean time-to-recovery (MTTR) across experiment results.
 *
 * Only results that actually recovered contribute to the mean.
 * @param results Experiment results to aggregate.
 * @returns MTTR in seconds, or null when no result recovered.
 */
export function meanTimeToRecovery(results: readonly ChaosExperimentResult[]): number | null {
  const recovered = results
    .map((result) => result.recovery.timeToRecoverySeconds)
    .filter((seconds): seconds is number => seconds !== null);
  if (recovered.length === 0) return null;
  return recovered.reduce((sum, seconds) => sum + seconds, 0) / recovered.length;
}

/** Injected dependencies for {@link runChaosExperiment}. */
export interface RunChaosDependencies {
  client: ChaosClient;
  monitor: ChaosMonitor;
}

/**
 * Runs one chaos experiment end to end against injected boundaries.
 *
 * Validates the experiment, optionally enforces a low-traffic scheduling
 * window, injects the attack via the client, observes behaviour via the
 * monitor, and always halts the attack afterwards. All chaos-tool interaction
 * is behind the injected client/monitor, so no live HTTP occurs here.
 * @param experiment The experiment to run.
 * @param deps Injected chaos client and monitor.
 * @param options Clock and scheduling-window controls.
 * @returns The full experiment result including gaps and resilience score.
 * @throws Error when validation fails, the window is required but not open,
 *   or the client/monitor rejects (after best-effort halt).
 */
export async function runChaosExperiment(
  experiment: ChaosExperiment,
  deps: RunChaosDependencies,
  options: RunChaosOptions = {}
): Promise<ChaosExperimentResult> {
  validateChaosExperiment(experiment);
  if (deps.client.provider !== experiment.provider) {
    throw new Error(`client provider ${deps.client.provider} does not match experiment provider ${experiment.provider}`);
  }
  const now = options.now ?? ((): Date => new Date());
  const injectedAt = isoNow(now);

  if (options.requireLowTrafficWindow) {
    const windows = options.lowTrafficWindows ?? [];
    if (windows.length === 0 || !isWithinLowTrafficWindow(injectedAt, windows)) {
      throw new Error('chaos run blocked: current time is outside all low-traffic windows');
    }
  }

  const request = buildAttackRequest(experiment);
  let handle: ChaosAttackHandle;
  try {
    handle = await deps.client.inject(request);
  } catch (error) {
    log.error('Chaos attack injection failed', error);
    throw error instanceof Error ? error : new Error(String(error));
  }

  let observation: ChaosObservation;
  try {
    observation = await deps.monitor({ experiment, handle, injectedAt });
  } catch (error) {
    log.error('Chaos observation failed', error);
    await safeHalt(deps.client, handle);
    throw error instanceof Error ? error : new Error(String(error));
  }
  await safeHalt(deps.client, handle);
  const haltedAt = isoNow(now);

  const recovery = computeTimeToRecovery(injectedAt, observation.recoverySamples);
  const slo = validateRecoverySlo(recovery, experiment.recoverySloSeconds);
  const comparison = compareExpectedVsActual(experiment.validationChecks, observation.checkObservations);
  const errorRate = computeErrorRateComparison(observation.normalErrorRate, observation.chaosErrorRate);
  const gapRecommendations = recommendTestGaps(experiment, recovery, slo, comparison, errorRate);
  const score = scoreChaosResult(recovery, slo, comparison, errorRate);
  const passed = slo.withinSlo && comparison.cleanResilience;
  const summary = buildSummary(experiment, recovery, slo, comparison, passed, score);

  const result: ChaosExperimentResult = {
    experimentId: experiment.id,
    provider: experiment.provider,
    failureType: experiment.failureType,
    target: experiment.target,
    injectedAt,
    haltedAt,
    recovery,
    slo,
    comparison,
    errorRate,
    gapRecommendations,
    passed,
    score,
    summary
  };

  if (passed) {
    log.info('Chaos experiment passed', { experiment: experiment.id, score });
  } else {
    log.warn('Chaos experiment surfaced resilience gaps', {
      experiment: experiment.id,
      score,
      unexpectedBreaks: comparison.unexpectedBreaks.length,
      withinSlo: slo.withinSlo
    });
  }
  return result;
}

/** Classifies a single check outcome from expected vs actual. */
function classifyOutcome(expectedToHold: boolean, actualHeld: boolean): ChaosCheckOutcome {
  if (expectedToHold && actualHeld) return 'held-as-expected';
  if (expectedToHold && !actualHeld) return 'unexpected-break';
  if (!expectedToHold && !actualHeld) return 'expected-break';
  return 'unexpected-resilience';
}

/** Builds a human-readable summary line for a result. */
function buildSummary(
  experiment: ChaosExperiment,
  recovery: RecoveryResult,
  slo: SloValidation,
  comparison: BehaviorComparison,
  passed: boolean,
  score: number
): string {
  const recoveryText = recovery.recovered
    ? `recovered in ${recovery.timeToRecoverySeconds}s (SLO ${slo.recoverySloSeconds}s${slo.withinSlo ? ', met' : ', BREACHED'})`
    : 'never recovered';
  const breakText = comparison.unexpectedBreaks.length === 0
    ? 'no unexpected breaks'
    : `${comparison.unexpectedBreaks.length} unexpected break(s)`;
  return `${experiment.failureType} on ${experiment.target}: ${passed ? 'PASS' : 'FAIL'} (score ${score}); ${recoveryText}; ${breakText}`;
}

/** Halts an attack, logging but never throwing on cleanup failure. */
async function safeHalt(client: ChaosClient, handle: ChaosAttackHandle): Promise<void> {
  try {
    await client.halt(handle);
  } catch (error) {
    log.error('Chaos attack halt failed', error);
  }
}

/** Returns whether an hour (0..23) falls in a half-open UTC window. */
function hourInWindow(hour: number, window: LowTrafficWindow): boolean {
  const { startHourUtc, endHourUtc } = window;
  if (startHourUtc < endHourUtc) return hour >= startHourUtc && hour < endHourUtc;
  // Overnight window spanning midnight, e.g. 22 -> 4.
  return hour >= startHourUtc || hour < endHourUtc;
}

/** Extracts a raw experiment list from a parsed YAML document. */
function extractExperimentList(document: unknown): unknown[] {
  if (document && typeof document === 'object' && 'experiments' in document) {
    const list = (document as { experiments?: unknown }).experiments;
    if (!Array.isArray(list)) throw new Error('Chaos YAML "experiments" must be an array');
    return list;
  }
  if (document && typeof document === 'object') return [document];
  throw new Error('Chaos YAML must be an object or list of experiments');
}

/** Coerces a raw YAML value into a typed ChaosExperiment (validated later). */
function normalizeExperiment(raw: unknown): ChaosExperiment {
  if (!raw || typeof raw !== 'object') throw new Error('each chaos experiment must be an object');
  const value = raw as Record<string, unknown>;
  const checks = Array.isArray(value['validationChecks']) ? (value['validationChecks'] as unknown[]) : [];
  return {
    id: String(value['id'] ?? ''),
    provider: value['provider'] as ChaosProvider,
    failureType: value['failureType'] as ChaosFailureType,
    target: String(value['target'] ?? ''),
    durationSeconds: Number(value['durationSeconds']),
    intensity: Number(value['intensity']),
    recoverySloSeconds: Number(value['recoverySloSeconds']),
    validationChecks: checks.map(normalizeCheck)
  };
}

/** Coerces a raw YAML value into a typed ChaosValidationCheck. */
function normalizeCheck(raw: unknown): ChaosValidationCheck {
  if (!raw || typeof raw !== 'object') throw new Error('each validation check must be an object');
  const value = raw as Record<string, unknown>;
  return {
    id: String(value['id'] ?? ''),
    description: String(value['description'] ?? ''),
    metric: String(value['metric'] ?? ''),
    expectedToHold: value['expectedToHold'] === true
  };
}

/** Returns an ISO timestamp from an injected clock, validating it is a real date. */
function isoNow(now: () => Date): string {
  const time = now().getTime();
  if (!Number.isFinite(time)) throw new Error('clock returned an invalid date');
  return new Date(time).toISOString();
}

/** Formats a ratio for messages, using a compact fixed precision. */
function formatRatio(ratio: number): string {
  return Number.isFinite(ratio) ? ratio.toFixed(1) : '∞';
}

/** Validates a low-traffic window's hour bounds. */
function validateWindow(window: LowTrafficWindow): void {
  if (!Number.isInteger(window.startHourUtc) || window.startHourUtc < 0 || window.startHourUtc > 23) {
    throw new Error('startHourUtc must be an integer in [0, 23]');
  }
  if (!Number.isInteger(window.endHourUtc) || window.endHourUtc < 1 || window.endHourUtc > HOURS_PER_DAY) {
    throw new Error('endHourUtc must be an integer in [1, 24]');
  }
}

/** Asserts a value is a rate in [0, 1]. */
function assertRate(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
}

/** Asserts a string value is present and non-blank. */
function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
}
