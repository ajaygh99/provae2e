import type { Plugin, PluginReport, TestResult } from './plugin.js';

export interface ReportingPlugin extends Plugin {
  readonly type: 'reporting';
  generateReport(results: TestResult[]): Promise<PluginReport>;
  exportFormat(report: PluginReport, format: string): Promise<Buffer>;
}
