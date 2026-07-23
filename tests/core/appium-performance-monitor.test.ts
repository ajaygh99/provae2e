import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AppiumPerformanceMonitor,
  AndroidAdbMetricCollector,
  analyzeSamples,
  parseAndroidBattery,
  parseAndroidCpu,
  parseAndroidFps,
  parseAndroidMemoryMb,
  type DeviceMetricCollector,
  type DevicePerformanceSample,
  type PerformanceThresholds
} from '../../src/core/appium-performance-monitor';

const thresholds: PerformanceThresholds = {
  cpuPercent: 80, memoryMb: 512, batteryDrainPercentPerMinute: 2,
  minimumFps: 30, memoryLeakMbPerMinute: 10
};

describe('Android metric parsers', () => {
  it('parses adb top, meminfo, battery, and gfxinfo', () => {
    expect(parseAndroidCpu('123 u0_a1 85.5% com.acme.app', 'com.acme.app')).toBe(85.5);
    expect(parseAndroidMemoryMb(' TOTAL PSS: 204800')).toBe(200);
    expect(parseAndroidBattery('level: 45\nscale: 90')).toBe(50);
    expect(parseAndroidFps('HISTOGRAM: 5ms=2 16ms=6 20ms=2')).toBe(48);
  });

  it('handles unavailable FPS and malformed required data', () => {
    expect(parseAndroidFps('no histogram')).toBeUndefined();
    expect(parseAndroidFps('16ms=0')).toBeUndefined();
    expect(() => parseAndroidCpu('nothing', 'app')).toThrow('CPU data not found');
    expect(() => parseAndroidMemoryMb('nothing')).toThrow('Memory TOTAL not found');
    expect(() => parseAndroidBattery('scale: 0')).toThrow('Battery level not found');
    expect(() => parseAndroidBattery('level: 5\nscale: 0')).toThrow('Battery level not found');
    expect(() => parseAndroidMemoryMb('TOTAL NaN')).toThrow('Memory TOTAL not found');
    expect(() => new AndroidAdbMetricCollector(' ')).toThrow('packageName is required');
  });
});

describe('performance analysis', () => {
  const sample = (seconds: number, memoryMb: number, overrides: Partial<DevicePerformanceSample> = {}): DevicePerformanceSample => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(),
    cpuPercent: 20, memoryMb, batteryPercent: 90, fps: 60, batteryDrainPercentPerMinute: 0.5, ...overrides
  });

  it('flags threshold regressions and monotonic memory leaks', () => {
    const alerts = analyzeSamples([
      sample(0, 100),
      sample(30, 110),
      sample(60, 121, { cpuPercent: 81, batteryDrainPercentPerMinute: 3, fps: 20, memoryMb: 600 })
    ], thresholds);
    expect(alerts.map(alert => alert.metric)).toEqual(['cpu', 'memory', 'battery', 'fps', 'memory-leak']);
  });

  it('does not flag absent FPS, short runs, or non-monotonic memory', () => {
    expect(analyzeSamples([], thresholds)).toEqual([]);
    expect(analyzeSamples([
      sample(0, 100, { fps: undefined }),
      sample(30, 120, { fps: undefined }),
      sample(60, 110, { fps: undefined })
    ], thresholds)).toEqual([]);
  });
});

describe('AppiumPerformanceMonitor', () => {
  it('samples at the configured cadence, persists SQLite, computes drain, and renders a graph', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-appium-perf-'));
    const database = path.join(directory, 'metrics.sqlite');
    let time = Date.UTC(2026, 0, 1);
    let call = 0;
    const collector: DeviceMetricCollector = {
      sample: jest.fn(async () => ({ cpuPercent: 10 + call, memoryMb: 100 + call++, batteryPercent: 90 - call, fps: 60 }))
    };
    let releases = 0;
    const monitor = await AppiumPerformanceMonitor.open(database, collector, {
      now: (): Date => new Date(time),
      sleep: async (milliseconds: number): Promise<void> => { time += milliseconds; releases++; if (releases >= 3) await new Promise(resolve => setImmediate(resolve)); }
    });
    const result = await monitor.monitor('checkout <flow>', 'android', async () => {
      while (releases < 3) await new Promise(resolve => setImmediate(resolve));
      return 'passed';
    });
    expect(result.value).toBe('passed');
    expect(result.run.samples).toHaveLength(3);
    expect(result.run.samples[1]?.batteryDrainPercentPerMinute).toBe(120);
    expect(result.run.alerts.map(alert => alert.metric)).toContain('battery');
    expect(monitor.report(result.run)).toContain('checkout &lt;flow&gt; performance over time');
    expect((await readFile(database)).subarray(0, 6).toString()).toBe('SQLite');
  });

  it('builds mean plus two standard deviations from the last ten matching runs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-appium-baseline-'));
    const database = path.join(directory, 'metrics.sqlite');
    let time = Date.UTC(2026, 0, 1);
    let cpu = 10;
    const collector: DeviceMetricCollector = { sample: async () => ({ cpuPercent: cpu, memoryMb: 100, batteryPercent: 90 }) };
    const options = {
      now: (): Date => new Date(time++),
      sleep: async (): Promise<void> => { await new Promise(resolve => setImmediate(resolve)); }
    };
    const monitor = await AppiumPerformanceMonitor.open(database, collector, options);
    for (let index = 0; index < 2; index++) {
      cpu = 10 + index * 10;
      await monitor.monitor('baseline', 'ios', async () => { await new Promise(resolve => setImmediate(resolve)); });
    }
    cpu = 14;
    const { run } = await monitor.monitor('baseline', 'ios', async () => { await new Promise(resolve => setImmediate(resolve)); });
    expect(run.thresholds.cpuPercent).toBe(25);
  });

  it('validates options, identity, collected metrics, and propagates collector failures', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-appium-errors-'));
    await expect(AppiumPerformanceMonitor.open(path.join(directory, 'a.db'), { sample: async () => ({ cpuPercent: 0, memoryMb: 0, batteryPercent: 0 }) }, { sampleIntervalMs: 0 })).rejects.toThrow('positive');
    const broken = await AppiumPerformanceMonitor.open(path.join(directory, 'b.db'), { sample: async () => { throw new Error('adb missing'); } }, { sleep: async () => undefined });
    await expect(broken.monitor('test', 'android', async () => undefined)).rejects.toThrow('adb missing');
    const invalid = await AppiumPerformanceMonitor.open(path.join(directory, 'c.db'), { sample: async () => ({ cpuPercent: -1, memoryMb: 0, batteryPercent: 0 }) }, { sleep: async () => undefined });
    await expect(invalid.monitor('test', 'android', async () => undefined)).rejects.toThrow('out of range');
    await expect(invalid.monitor('', 'android', async () => undefined)).rejects.toThrow('testName is required');
    await expect(invalid.monitor('test', '', async () => undefined)).rejects.toThrow('platform is required');

    const defaults = await AppiumPerformanceMonitor.open(
      path.join(directory, 'defaults.db'),
      { sample: async () => ({ cpuPercent: 0, memoryMb: 0, batteryPercent: 0 }) }
    );
    expect(defaults).toBeInstanceOf(AppiumPerformanceMonitor);
  });
});
