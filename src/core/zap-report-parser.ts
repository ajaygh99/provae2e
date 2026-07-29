/** Bounded OWASP ZAP JSON report ingestion and normalization. */
import { zapFindingKey, type ZapFinding, type ZapRisk } from './zap-false-positive-filter.js';

const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const MAX_FINDINGS = 25_000;
const MAX_EVIDENCE_LENGTH = 500;

export interface ZapReportParseResult {
  findings: ZapFinding[];
  warnings: string[];
}

/** Parses a ZAP traditional JSON report into deduplicated PROVA findings. */
export function parseZapJsonReport(source: string): ZapReportParseResult {
  if (Buffer.byteLength(source, 'utf8') > MAX_REPORT_BYTES) {
    throw new Error(`ZAP report exceeds the ${MAX_REPORT_BYTES} byte safety limit`);
  }
  let report: unknown;
  try {
    report = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid ZAP JSON report: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(report) || !Array.isArray(report.site)) {
    throw new Error('ZAP JSON report must contain a site array');
  }
  const warnings: string[] = [];
  const findings = new Map<string, ZapFinding>();
  for (const [siteIndex, site] of report.site.entries()) {
    if (!isRecord(site) || !Array.isArray(site.alerts)) {
      warnings.push(`site[${siteIndex}] ignored because alerts is not an array`);
      continue;
    }
    for (const [alertIndex, alert] of site.alerts.entries()) {
      if (!isRecord(alert)) {
        warnings.push(`site[${siteIndex}].alerts[${alertIndex}] ignored because it is not an object`);
        continue;
      }
      const alertId = text(alert.pluginid ?? alert.alertRef);
      const name = text(alert.alert ?? alert.name);
      const risk = riskFrom(alert.riskcode, alert.riskdesc);
      const instances = Array.isArray(alert.instances) ? alert.instances : [];
      if (!alertId || !name || !risk || instances.length === 0) {
        warnings.push(`site[${siteIndex}].alerts[${alertIndex}] ignored because required fields are missing`);
        continue;
      }
      for (const [instanceIndex, instance] of instances.entries()) {
        if (findings.size >= MAX_FINDINGS) throw new Error(`ZAP report exceeds the ${MAX_FINDINGS} finding safety limit`);
        if (!isRecord(instance)) {
          warnings.push(`alert ${alertId} instance[${instanceIndex}] ignored because it is not an object`);
          continue;
        }
        const url = safeHttpUrl(text(instance.uri ?? instance.url));
        if (!url) {
          warnings.push(`alert ${alertId} instance[${instanceIndex}] ignored because URL is not HTTP(S)`);
          continue;
        }
        const finding: ZapFinding = {
          alertId,
          name,
          risk,
          url,
          ...(text(alert.cweid) && text(alert.cweid) !== '-1' ? { cwe: `CWE-${text(alert.cweid)}` } : {}),
          ...(text(instance.param) ? { parameter: text(instance.param) } : {}),
          ...(text(instance.evidence) ? { evidence: redactEvidence(text(instance.evidence)) } : {})
        };
        findings.set(zapFindingKey(finding), finding);
      }
    }
  }
  return { findings: [...findings.values()], warnings };
}

function riskFrom(code: unknown, description: unknown): ZapRisk | undefined {
  const normalized = text(description).split(/\s|\(/)[0]?.toUpperCase();
  if (['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized)) return normalized as ZapRisk;
  const numeric = Number(code);
  return ({ 0: 'INFO', 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH', 4: 'CRITICAL' } as Record<number, ZapRisk>)[numeric];
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function redactEvidence(value: string): string {
  return value
    .replace(/((?:authorization|cookie|token|api[_-]?key|password)\s*[:=]\s*)[^\s;,]+/gi, '$1[REDACTED]')
    .slice(0, MAX_EVIDENCE_LENGTH);
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
