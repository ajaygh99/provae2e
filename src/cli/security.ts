import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../core/logger.js';
import {
  ZapFalsePositiveFilter,
  parseZapFilterRules,
  type ZapRisk
} from '../core/zap-false-positive-filter.js';
import { parseZapJsonReport } from '../core/zap-report-parser.js';
import { evaluateZapScanPolicy, type ZapScanPolicy } from '../core/zap-scan-policy.js';
import {
  buildZapSecurityReport,
  renderZapSecurityJson,
  renderZapSecurityMarkdown
} from '../reporters/zap-security-reporter.js';

const RISKS: ZapRisk[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export interface SecurityActionOptions {
  report: string;
  target: string;
  database: string;
  rules?: string;
  format: string;
  output?: string;
  minimumRisk: string;
  maximumFindings: string;
  maximumInfo?: string;
  maximumLow?: string;
  maximumMedium?: string;
  maximumHigh?: string;
  maximumCritical?: string;
  allFindings: boolean;
}

/** Processes a local ZAP report and sets a failing exit code when policy does not pass. */
export async function securityCommand(options: SecurityActionOptions): Promise<void> {
  try {
    const policy = parsePolicy(options);
    if (!['json', 'markdown'].includes(options.format)) {
      throw new Error('--format must be json or markdown');
    }
    if (!options.target.trim()) throw new Error('--target is required');
    const source = await readFile(options.report, 'utf8');
    const parsed = parseZapJsonReport(source);
    const rules = options.rules
      ? parseZapFilterRules(await readFile(options.rules, 'utf8'))
      : [];
    const engine = await ZapFalsePositiveFilter.open(options.database);
    const scan = await engine.processScan(options.target.trim(), parsed.findings, rules);
    const evaluation = evaluateZapScanPolicy(scan, policy);
    const report = buildZapSecurityReport(scan, evaluation);
    const output = options.format === 'json'
      ? renderZapSecurityJson(report)
      : renderZapSecurityMarkdown(report);
    if (options.output) {
      const outputPath = path.resolve(options.output);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, output, { encoding: 'utf8', flag: 'w' });
    } else {
      process.stdout.write(output);
    }
    log.info('ZAP security report processed', {
      passed: evaluation.passed,
      visible: scan.visible.length,
      filtered: scan.filtered.length,
      newFindings: scan.newFindings.length,
      warnings: parsed.warnings.length,
      format: options.format,
      ...(options.output ? { output: path.resolve(options.output) } : {})
    });
    if (!evaluation.passed) process.exitCode = 1;
  } catch (error) {
    log.error(`ZAP security processing failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function parsePolicy(options: SecurityActionOptions): ZapScanPolicy {
  const minimumRisk = options.minimumRisk.toUpperCase();
  if (!RISKS.includes(minimumRisk as ZapRisk)) {
    throw new Error('--minimum-risk must be INFO, LOW, MEDIUM, HIGH, or CRITICAL');
  }
  const maximumByRisk: Partial<Record<ZapRisk, number>> = {};
  const riskBudgets: Array<[ZapRisk, string | undefined]> = [
    ['INFO', options.maximumInfo],
    ['LOW', options.maximumLow],
    ['MEDIUM', options.maximumMedium],
    ['HIGH', options.maximumHigh],
    ['CRITICAL', options.maximumCritical]
  ];
  for (const [risk, value] of riskBudgets) {
    if (value !== undefined) maximumByRisk[risk] = nonNegativeInteger(value, `--maximum-${risk.toLowerCase()}`);
  }
  return {
    minimumRisk: minimumRisk as ZapRisk,
    maximumFindings: nonNegativeInteger(options.maximumFindings, '--maximum-findings'),
    newFindingsOnly: !options.allFindings,
    maximumByRisk
  };
}

function nonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}
