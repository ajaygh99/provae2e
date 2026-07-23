/** Appium device performance sampling, persistence, regression analysis, and reporting. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
let sqlitePromise: Promise<SqlJsStatic> | undefined;

export interface DevicePerformanceSample {
  timestamp: string;
  cpuPercent: number;
  memoryMb: number;
  batteryPercent: number;
  batteryDrainPercentPerMinute?: number;
  fps?: number;
}

export interface DeviceMetricCollector {
  sample(): Promise<Omit<DevicePerformanceSample, 'timestamp' | 'batteryDrainPercentPerMinute'>>;
}

export interface PerformanceThresholds {
  cpuPercent: number;
  memoryMb: number;
  batteryDrainPercentPerMinute: number;
  minimumFps: number;
  memoryLeakMbPerMinute: number;
}

export interface PerformanceAlert {
  metric: 'cpu' | 'memory' | 'battery' | 'fps' | 'memory-leak';
  message: string;
  observed: number;
  threshold: number;
}

export interface DevicePerformanceRun {
  id: string;
  testName: string;
  platform: string;
  startedAt: string;
  endedAt: string;
  samples: DevicePerformanceSample[];
  thresholds: PerformanceThresholds;
  alerts: PerformanceAlert[];
  potentialMemoryLeak: boolean;
}

export interface MonitorOptions {
  sampleIntervalMs?: number;
  thresholds?: Partial<PerformanceThresholds>;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  cpuPercent: 80,
  memoryMb: 512,
  batteryDrainPercentPerMinute: 2,
  minimumFps: 30,
  memoryLeakMbPerMinute: 10
};

/**
 * Collects Android process metrics using adb.
 */
export class AndroidAdbMetricCollector implements DeviceMetricCollector {
  /**
   * @param packageName Android application package.
   * @param adbPath Optional adb executable path.
   */
  constructor(private readonly packageName: string, private readonly adbPath = 'adb') {
    if (!packageName.trim()) throw new Error('packageName is required');
  }

  /** @returns Current CPU, memory, battery, and optional FPS metrics. */
  async sample(): Promise<Omit<DevicePerformanceSample, 'timestamp' | 'batteryDrainPercentPerMinute'>> {
    try {
      const [top, memory, battery, gfx] = await Promise.all([
        this.adb(['shell', 'top', '-n', '1', '-b']),
        this.adb(['shell', 'dumpsys', 'meminfo', this.packageName]),
        this.adb(['shell', 'dumpsys', 'battery']),
        this.adb(['shell', 'dumpsys', 'gfxinfo', this.packageName])
      ]);
      const cpu = parseAndroidCpu(top, this.packageName);
      const memoryMb = parseAndroidMemoryMb(memory);
      const batteryPercent = parseAndroidBattery(battery);
      const fps = parseAndroidFps(gfx);
      return { cpuPercent: cpu, memoryMb, batteryPercent, ...(fps === undefined ? {} : { fps }) };
    } catch (error) {
      throw new Error(`Unable to collect Android performance metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async adb(args: string[]): Promise<string> {
    const result = await execFileAsync(this.adbPath, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout;
  }
}

/** Parses a process CPU percentage from Android top output. */
export function parseAndroidCpu(output: string, packageName: string): number {
  const line = output.split(/\r?\n/).find(candidate => candidate.includes(packageName));
  const matches = line?.match(/\b(\d+(?:\.\d+)?)%/g);
  if (!matches?.[0]) throw new Error(`CPU data not found for ${packageName}`);
  return finiteMetric(Number.parseFloat(matches[0]), 'CPU');
}

/** Parses total process memory from Android dumpsys meminfo output. */
export function parseAndroidMemoryMb(output: string): number {
  const match = output.match(/TOTAL(?:\s+PSS)?:?\s+(\d+)/i);
  if (!match?.[1]) throw new Error('Memory TOTAL not found');
  return finiteMetric(Number(match[1]) / 1024, 'memory');
}

/** Parses battery percentage from Android dumpsys battery output. */
export function parseAndroidBattery(output: string): number {
  const level = output.match(/level:\s*(\d+)/i)?.[1];
  const scale = output.match(/scale:\s*(\d+)/i)?.[1] ?? '100';
  if (!level || Number(scale) <= 0) throw new Error('Battery level not found');
  return finiteMetric(Number(level) / Number(scale) * 100, 'battery');
}

/** Estimates rendered FPS from the gfxinfo HISTOGRAM frame-duration buckets. */
export function parseAndroidFps(output: string): number | undefined {
  const buckets = [...output.matchAll(/(\d+)ms=(\d+)/g)];
  const total = buckets.reduce((sum, item) => sum + Number(item[2]), 0);
  if (total === 0) return undefined;
  const smooth = buckets.filter(item => Number(item[1]) <= 16).reduce((sum, item) => sum + Number(item[2]), 0);
  return Number((60 * smooth / total).toFixed(2));
}

/** SQLite-backed device performance monitor. */
export class AppiumPerformanceMonitor {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly collector: DeviceMetricCollector,
    private readonly options: Required<Pick<MonitorOptions, 'sampleIntervalMs' | 'now' | 'sleep'>> & MonitorOptions
  ) {}

  /**
   * Opens a performance monitor and creates its SQLite schema.
   * @param filePath SQLite file location.
   * @param collector Platform metric collector.
   * @param options Sampling, threshold, and clock options.
   * @returns Initialized monitor.
   */
  static async open(filePath: string, collector: DeviceMetricCollector, options: MonitorOptions = {}): Promise<AppiumPerformanceMonitor> {
    const interval = options.sampleIntervalMs ?? 500;
    if (!Number.isFinite(interval) || interval <= 0) throw new Error('sampleIntervalMs must be positive');
    sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
    const SQL = await sqlitePromise;
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS appium_performance_runs (
        id TEXT PRIMARY KEY, test_name TEXT NOT NULL, platform TEXT NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT NOT NULL, summary_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS appium_performance_samples (
        run_id TEXT NOT NULL, timestamp TEXT NOT NULL, cpu REAL NOT NULL,
        memory REAL NOT NULL, battery REAL NOT NULL, battery_drain REAL, fps REAL
      );
      CREATE INDEX IF NOT EXISTS idx_appium_perf_test ON appium_performance_runs(test_name, platform, started_at);
    `);
    const monitor = new AppiumPerformanceMonitor(path.resolve(filePath), database, collector, {
      ...options,
      sampleIntervalMs: interval,
      now: options.now ?? ((): Date => new Date()),
      sleep: options.sleep ?? ((milliseconds: number): Promise<void> =>
        new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, milliseconds)))
    });
    await monitor.persist();
    return monitor;
  }

  /**
   * Samples every configured interval while a test action executes.
   * @param testName Stable test identifier used for the ten-run baseline.
   * @param platform Device platform label.
   * @param action Test execution callback.
   * @returns Test callback value and completed performance run.
   */
  async monitor<T>(testName: string, platform: string, action: () => Promise<T>): Promise<{ value: T; run: DevicePerformanceRun }> {
    required(testName, 'testName');
    required(platform, 'platform');
    const startedAt = this.options.now();
    const samples: DevicePerformanceSample[] = [];
    let active = true;
    let collectionError: Error | undefined;
    const collect = async (): Promise<void> => {
      while (active) {
        try {
          samples.push(await this.collectSample(samples.at(-1)));
        } catch (error) {
          collectionError = error instanceof Error ? error : new Error(String(error));
          active = false;
          return;
        }
        await this.options.sleep(this.options.sampleIntervalMs);
      }
    };
    const sampling = collect();
    let value: T;
    try {
      value = await action();
    } finally {
      active = false;
      await sampling;
    }
    if (collectionError) throw collectionError;
    const endedAt = this.options.now();
    const thresholds = this.resolveThresholds(testName, platform);
    const alerts = analyzeSamples(samples, thresholds);
    const run: DevicePerformanceRun = {
      id: `${slug(testName)}-${startedAt.getTime()}`,
      testName,
      platform,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      samples,
      thresholds,
      alerts,
      potentialMemoryLeak: alerts.some(alert => alert.metric === 'memory-leak')
    };
    this.store(run);
    await this.persist();
    return { value, run };
  }

  /**
   * Renders a dependency-free SVG time-series graph.
   * @param run Completed performance run.
   * @returns SVG document containing CPU, memory, battery drain, and FPS series.
   */
  report(run: DevicePerformanceRun): string {
    const metrics = [
      ['CPU %', 'cpuPercent', '#ef4444'],
      ['Memory MB', 'memoryMb', '#3b82f6'],
      ['Battery %/min', 'batteryDrainPercentPerMinute', '#f59e0b'],
      ['FPS', 'fps', '#22c55e']
    ] as const;
    const width = 900;
    const height = 420;
    const paths = metrics.map(([label, key, color], index) => {
      const values = run.samples.map(sample => sample[key]).filter((value): value is number => value !== undefined);
      const max = Math.max(...values, 1);
      const points = run.samples.map((sample, sampleIndex) => {
        const value = sample[key];
        if (value === undefined) return '';
        const x = 50 + sampleIndex * 800 / Math.max(run.samples.length - 1, 1);
        const y = 360 - value / max * 300;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).filter(Boolean).join(' ');
      return `<polyline data-metric="${escapeXml(label)}" fill="none" stroke="${color}" stroke-width="2" points="${points}"/><text x="${60 + index * 190}" y="400" fill="${color}">${escapeXml(label)}</text>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="Performance graph for ${escapeXml(run.testName)}"><rect width="100%" height="100%" fill="white"/><text x="50" y="30">${escapeXml(run.testName)} performance over time</text>${paths}</svg>`;
  }

  private async collectSample(previous?: DevicePerformanceSample): Promise<DevicePerformanceSample> {
    const metric = await this.collector.sample();
    validateCollectedMetric(metric);
    const timestamp = this.options.now().toISOString();
    let drain: number | undefined;
    if (previous) {
      const minutes = (Date.parse(timestamp) - Date.parse(previous.timestamp)) / 60_000;
      if (minutes > 0) drain = Math.max(0, (previous.batteryPercent - metric.batteryPercent) / minutes);
    }
    return { timestamp, ...metric, ...(drain === undefined ? {} : { batteryDrainPercentPerMinute: Number(drain.toFixed(4)) }) };
  }

  private resolveThresholds(testName: string, platform: string): PerformanceThresholds {
    const configured = { ...DEFAULT_THRESHOLDS, ...this.options.thresholds };
    const result = this.database.exec(
      `SELECT summary_json FROM appium_performance_runs
       WHERE test_name=? AND platform=? ORDER BY started_at DESC LIMIT 10`,
      [testName, platform]
    );
    const historic = (result[0]?.values ?? []).map(row => JSON.parse(row[0] as string) as Record<string, number>);
    const dynamic = (key: string, fallback: number): number => {
      const values = historic.map(item => item[key]).filter(Number.isFinite);
      if (values.length < 2) return fallback;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
      return Number((mean + 2 * deviation).toFixed(4));
    };
    return {
      ...configured,
      cpuPercent: dynamic('meanCpu', configured.cpuPercent),
      memoryMb: dynamic('meanMemory', configured.memoryMb),
      batteryDrainPercentPerMinute: dynamic('meanBatteryDrain', configured.batteryDrainPercentPerMinute)
    };
  }

  private store(run: DevicePerformanceRun): void {
    const mean = (values: number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    const summary = JSON.stringify({
      meanCpu: mean(run.samples.map(sample => sample.cpuPercent)),
      meanMemory: mean(run.samples.map(sample => sample.memoryMb)),
      meanBatteryDrain: mean(run.samples.flatMap(sample => sample.batteryDrainPercentPerMinute === undefined ? [] : [sample.batteryDrainPercentPerMinute]))
    });
    this.database.run(
      'INSERT INTO appium_performance_runs VALUES (?, ?, ?, ?, ?, ?)',
      [run.id, run.testName, run.platform, run.startedAt, run.endedAt, summary]
    );
    run.samples.forEach(sample => this.database.run(
      'INSERT INTO appium_performance_samples VALUES (?, ?, ?, ?, ?, ?, ?)',
      [run.id, sample.timestamp, sample.cpuPercent, sample.memoryMb, sample.batteryPercent,
        sample.batteryDrainPercentPerMinute ?? null, sample.fps ?? null]
    ));
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}

/** Evaluates samples against thresholds and detects sustained memory growth. */
export function analyzeSamples(samples: DevicePerformanceSample[], thresholds: PerformanceThresholds): PerformanceAlert[] {
  if (samples.length === 0) return [];
  const max = (selector: (sample: DevicePerformanceSample) => number | undefined): number =>
    Math.max(...samples.flatMap(sample => selector(sample) === undefined ? [] : [selector(sample) as number]), 0);
  const alerts: PerformanceAlert[] = [];
  const checks: Array<[PerformanceAlert['metric'], number, number, string]> = [
    ['cpu', max(sample => sample.cpuPercent), thresholds.cpuPercent, 'CPU percentage'],
    ['memory', max(sample => sample.memoryMb), thresholds.memoryMb, 'Memory usage'],
    ['battery', max(sample => sample.batteryDrainPercentPerMinute), thresholds.batteryDrainPercentPerMinute, 'Battery drain']
  ];
  checks.forEach(([metric, observed, threshold, label]) => {
    if (observed > threshold) alerts.push({ metric, observed, threshold, message: `${label} ${observed.toFixed(2)} exceeded ${threshold.toFixed(2)}` });
  });
  const fpsValues = samples.flatMap(sample => sample.fps === undefined ? [] : [sample.fps]);
  const minimumFps = fpsValues.length ? Math.min(...fpsValues) : undefined;
  if (minimumFps !== undefined && minimumFps < thresholds.minimumFps) {
    alerts.push({ metric: 'fps', observed: minimumFps, threshold: thresholds.minimumFps, message: `FPS ${minimumFps.toFixed(2)} fell below ${thresholds.minimumFps.toFixed(2)}` });
  }
  if (samples.length >= 3) {
    const first = samples[0] as DevicePerformanceSample;
    const last = samples.at(-1) as DevicePerformanceSample;
    const minutes = (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 60_000;
    const growth = minutes > 0 ? (last.memoryMb - first.memoryMb) / minutes : 0;
    const monotonicallyGrowing = samples.slice(1).every((sample, index) => sample.memoryMb >= (samples[index]?.memoryMb ?? sample.memoryMb));
    if (monotonicallyGrowing && growth > thresholds.memoryLeakMbPerMinute) {
      alerts.push({ metric: 'memory-leak', observed: growth, threshold: thresholds.memoryLeakMbPerMinute, message: `Memory grew ${growth.toFixed(2)} MB/min, indicating a potential leak` });
    }
  }
  return alerts;
}

function validateCollectedMetric(metric: Omit<DevicePerformanceSample, 'timestamp' | 'batteryDrainPercentPerMinute'>): void {
  finiteMetric(metric.cpuPercent, 'CPU');
  finiteMetric(metric.memoryMb, 'memory');
  finiteMetric(metric.batteryPercent, 'battery');
  if (metric.cpuPercent < 0 || metric.memoryMb < 0 || metric.batteryPercent < 0 || metric.batteryPercent > 100) {
    throw new Error('Collected device metrics are out of range');
  }
  if (metric.fps !== undefined && (!Number.isFinite(metric.fps) || metric.fps < 0)) throw new Error('FPS is out of range');
}

function finiteMetric(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} metric is invalid`);
  return value;
}

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'test';
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] as string);
}
