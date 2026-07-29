/** Deterministic, share-safe reporting for OWASP ZAP scan results. */
import type {
  FilteredZapFinding,
  ZapRisk,
  ZapScanResult
} from '../core/zap-false-positive-filter.js';
import type { ZapPolicyEvaluation } from '../core/zap-scan-policy.js';

const REPORT_SCHEMA_VERSION = 1;
const DEFAULT_MARKDOWN_FINDING_LIMIT = 100;
const RISK_ORDER: ZapRisk[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export interface ZapSecurityReportFinding {
  findingKey: string;
  alertId: string;
  name: string;
  risk: ZapRisk;
  url: string;
  cwe?: string;
  parameter?: string;
  isNew: boolean;
  disposition: FilteredZapFinding['disposition'];
  reason?: string;
}

export interface ZapSecurityReport {
  schemaVersion: 1;
  scan: {
    scanId: string;
    target: string;
    scannedAt: string;
    baselineEstablished: boolean;
  };
  summary: {
    passed: boolean;
    visible: number;
    filtered: number;
    newFindings: number;
    consideredFindings: number;
    countsByRisk: Record<ZapRisk, number>;
  };
  violations: ZapPolicyEvaluation['violations'];
  findings: ZapSecurityReportFinding[];
}

export interface ZapJiraSecurityStoryDraft {
  summary: string;
  description: string;
  labels: string[];
  priority: 'Highest' | 'High' | 'Medium' | 'Low';
}

/** Builds the canonical report model. Finding evidence is intentionally excluded. */
export function buildZapSecurityReport(
  scan: ZapScanResult,
  policy: ZapPolicyEvaluation
): ZapSecurityReport {
  const findings = [...scan.visible, ...scan.filtered]
    .map(toReportFinding)
    .sort(compareFindings);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    scan: {
      scanId: scan.scanId,
      target: scan.target,
      scannedAt: scan.scannedAt,
      baselineEstablished: scan.baselineEstablished
    },
    summary: {
      passed: policy.passed,
      visible: scan.visible.length,
      filtered: scan.filtered.length,
      newFindings: scan.newFindings.length,
      consideredFindings: policy.consideredFindings,
      countsByRisk: { ...policy.countsByRisk }
    },
    violations: policy.violations.map(violation => ({ ...violation })),
    findings
  };
}

/** Serializes a stable machine-readable artifact with a trailing newline. */
export function renderZapSecurityJson(report: ZapSecurityReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Renders a bounded Markdown summary suitable for CI and issue descriptions. */
export function renderZapSecurityMarkdown(
  report: ZapSecurityReport,
  findingLimit = DEFAULT_MARKDOWN_FINDING_LIMIT
): string {
  if (!Number.isInteger(findingLimit) || findingLimit < 0) {
    throw new Error('findingLimit must be a non-negative integer');
  }
  const status = report.summary.passed ? 'PASS' : 'FAIL';
  const lines = [
    '# ZAP security report',
    '',
    `- Status: **${status}**`,
    `- Target: \`${escapeInline(report.scan.target)}\``,
    `- Scan: \`${escapeInline(report.scan.scanId)}\``,
    `- Scanned at: ${report.scan.scannedAt}`,
    `- Baseline established: ${report.scan.baselineEstablished ? 'yes' : 'no'}`,
    `- Visible / filtered / new: ${report.summary.visible} / ${report.summary.filtered} / ${report.summary.newFindings}`,
    `- Policy findings: ${report.summary.consideredFindings}`,
    '',
    '## Risk summary',
    '',
    '| Risk | Count |',
    '| --- | ---: |',
    ...RISK_ORDER.map(risk => `| ${risk} | ${report.summary.countsByRisk[risk]} |`)
  ];
  if (report.violations.length > 0) {
    lines.push('', '## Policy violations', '');
    report.violations.forEach(violation => lines.push(`- ${escapeMarkdown(violation.message)}`));
  }
  lines.push('', '## Findings', '');
  const displayed = report.findings.slice(0, findingLimit);
  if (displayed.length === 0) lines.push('No findings to display.');
  else {
    lines.push('| Risk | Alert | Location | State |', '| --- | --- | --- | --- |');
    displayed.forEach(finding => lines.push(
      `| ${finding.risk} | ${escapeTable(finding.name)} (${escapeTable(finding.alertId)}) `
      + `| ${escapeTable(finding.url)} | ${finding.isNew ? 'new' : finding.disposition} |`
    ));
  }
  const omitted = report.findings.length - displayed.length;
  if (omitted > 0) lines.push('', `_${omitted} additional finding(s) omitted from this bounded view._`);
  return `${lines.join('\n')}\n`;
}

/** Creates a Jira-compatible draft; callers decide whether and where to publish it. */
export function createZapJiraSecurityStory(report: ZapSecurityReport): ZapJiraSecurityStoryDraft {
  const highestRisk = RISK_ORDER.find(risk => report.summary.countsByRisk[risk] > 0);
  return {
    summary: `[Security] ZAP ${report.summary.passed ? 'scan review' : 'policy failure'} for ${report.scan.target}`,
    description: renderZapSecurityMarkdown(report, 50),
    labels: ['security', 'owasp-zap', report.summary.passed ? 'security-scan-pass' : 'security-scan-fail'],
    priority: jiraPriority(highestRisk)
  };
}

function toReportFinding(item: FilteredZapFinding): ZapSecurityReportFinding {
  return {
    findingKey: item.findingKey,
    alertId: item.finding.alertId,
    name: item.finding.name,
    risk: item.finding.risk,
    url: shareSafeUrl(item.finding.url),
    ...(item.finding.cwe ? { cwe: item.finding.cwe } : {}),
    ...(item.finding.parameter ? { parameter: item.finding.parameter } : {}),
    isNew: item.isNew,
    disposition: item.disposition,
    ...(item.reason ? { reason: item.reason } : {})
  };
}

function shareSafeUrl(value: string): string {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
  return url.toString();
}

function compareFindings(left: ZapSecurityReportFinding, right: ZapSecurityReportFinding): number {
  return RISK_ORDER.indexOf(left.risk) - RISK_ORDER.indexOf(right.risk)
    || Number(right.isNew) - Number(left.isNew)
    || left.findingKey.localeCompare(right.findingKey);
}

function jiraPriority(risk: ZapRisk | undefined): ZapJiraSecurityStoryDraft['priority'] {
  if (risk === 'CRITICAL') return 'Highest';
  if (risk === 'HIGH') return 'High';
  if (risk === 'MEDIUM') return 'Medium';
  return 'Low';
}

function escapeInline(value: string): string {
  return value.replace(/`/g, '\\`').replace(/\r?\n/g, ' ');
}

function escapeMarkdown(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/([\\`*_{}[\]()#+.!|-])/g, '\\$1');
}

function escapeTable(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}
