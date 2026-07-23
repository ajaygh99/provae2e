# ARIA Plan — Issue #108: Sentinel Performance Baseline & Anomalies

## Source of truth
GitHub Issue #108 (epic:sentinel, phase3). NOTE: sprint/agent-tasks.md is STALE for
#108 (describes an Allure report) and is deliberately ignored.

## Goal
7-day rolling performance baselines per metric per service, z-score anomaly detection
that only alerts on persistent anomalies, gradual-degradation trend detection, causation
linking to a deploy/load spike, and export to an injected sink (Datadog/Prometheus/dashboard).

## Design (pragmatic, $0-to-test, unit-testable pure functions)
Two NEW modules — does NOT touch the existing fixed-threshold `performance-baseline.ts`
(K6) nor the log-sampling `sentinel-agent.ts`; complements the Sentinel domain.

### src/core/sentinel-baseline.ts (pure statistics)
- `SentinelMetricName`: p50/p95/p99 latency, throughput, error rate, CPU, memory.
- `MetricSample`, `RollingBaseline`, `RollingBaselineOptions` (windowDays=7, ignoreWeekends).
- `computeRollingBaseline` — mean + population stddev over the 7-day rolling window.
- `mean`, `populationStddev`, `zScore` helpers (reused by the anomaly module).

### src/core/sentinel-anomaly.ts (detection + orchestration + export boundary)
- `detectPersistentAnomaly` — z-score >= 2.0 per 5-min window; alerts only if the anomaly
  runs across 2+ consecutive windows. Direction-aware (throughput drop = low is bad).
- `detectDegradationTrend` — day-over-day percent change; degrading when 5+ consecutive
  days each move >= 2% in the bad direction. `linearRegressionSlope` reported alongside.
- `correlateCausation` — links an anomaly to the closest preceding deployment (commit)
  or load spike inside a lookback window.
- `toPrometheusMetrics` / `toDatadogSeries` — pure formatters; real network export is a
  thin injected `SentinelExporter` boundary (mocked in tests, per repo convention).
- `analyzeMetric` — orchestrates baseline -> anomaly -> persistence -> trend -> causation,
  and calls the injected exporter when an alert fires.

## Tests
tests/core/sentinel-baseline.test.ts, tests/core/sentinel-anomaly.test.ts — happy/error/
boundary paths incl. z-score exactly 2.0, exactly 2 consecutive windows, +2%/day x5 days.
