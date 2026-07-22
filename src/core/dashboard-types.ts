/** Dashboard and reporting types for Golden Thread. */
import type { Stage, StageStatus } from './golden-thread-store.js';

/** Metrics computed from a collection of Golden Thread chains. */
export interface DashboardMetrics {
  totalChains: number;
  overallPassRate: number;
  avgChainDuration: number;
  stagePassRates: Map<Stage, number>;
  stageDurations: Map<Stage, number>;
  commonFailures: { stage: Stage; count: number }[];
}

/** Filters for querying chains. */
export interface DashboardFilter {
  dateStart?: Date;
  dateEnd?: Date;
  environment?: string;
  team?: string;
  project?: string;
}

/** Minimal summary of a chain for dashboard display. */
export interface ChainSummary {
  id: string;
  status: 'PASS' | 'FAIL' | 'PENDING';
  duration: number;
  environment?: string;
  timestamp: string;
  stages: { stage: Stage; status: StageStatus; duration: number }[];
}

/** Duration data per stage for metrics. */
export interface StageDuration {
  stage: Stage;
  durations: number[];
  avgDuration: number;
}

/** Stage failure information. */
export interface StageFailure {
  stage: Stage;
  count: number;
  percentage: number;
}
