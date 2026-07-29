/** Deterministic CI policy evaluation for filtered OWASP ZAP scan results. */
import type { FilteredZapFinding, ZapRisk, ZapScanResult } from './zap-false-positive-filter.js';

const RISK_RANK: Record<ZapRisk, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export interface ZapScanPolicy {
  minimumRisk?: ZapRisk;
  newFindingsOnly?: boolean;
  maximumFindings?: number;
  maximumByRisk?: Partial<Record<ZapRisk, number>>;
}

export interface ZapPolicyViolation {
  code: 'finding-budget' | 'risk-budget';
  message: string;
  risk?: ZapRisk;
  actual: number;
  maximum: number;
}

export interface ZapPolicyEvaluation {
  passed: boolean;
  consideredFindings: number;
  countsByRisk: Record<ZapRisk, number>;
  violations: ZapPolicyViolation[];
}

/** Evaluates visible findings after baseline, whitelist, and rule filtering. */
export function evaluateZapScanPolicy(result: ZapScanResult, policy: ZapScanPolicy = {}): ZapPolicyEvaluation {
  const minimumRisk = policy.minimumRisk ?? 'MEDIUM';
  if (!(minimumRisk in RISK_RANK)) throw new Error('minimumRisk must be INFO, LOW, MEDIUM, HIGH, or CRITICAL');
  const maximumFindings = policy.maximumFindings ?? 0;
  validateBudget(maximumFindings, 'maximumFindings');
  for (const [risk, maximum] of Object.entries(policy.maximumByRisk ?? {})) {
    if (!(risk in RISK_RANK)) throw new Error(`Unknown risk budget: ${risk}`);
    validateBudget(maximum, `maximumByRisk.${risk}`);
  }
  const source = policy.newFindingsOnly === false ? result.visible : result.newFindings;
  const considered = source.filter((item) => RISK_RANK[item.finding.risk] >= RISK_RANK[minimumRisk]);
  const countsByRisk = countRisks(considered);
  const violations: ZapPolicyViolation[] = [];
  if (considered.length > maximumFindings) {
    violations.push({
      code: 'finding-budget',
      message: `${considered.length} qualifying finding(s) exceed the allowed total of ${maximumFindings}`,
      actual: considered.length,
      maximum: maximumFindings
    });
  }
  for (const risk of Object.keys(RISK_RANK) as ZapRisk[]) {
    const maximum = policy.maximumByRisk?.[risk];
    if (maximum !== undefined && countsByRisk[risk] > maximum) {
      violations.push({
        code: 'risk-budget',
        message: `${countsByRisk[risk]} ${risk} finding(s) exceed the allowed ${maximum}`,
        risk,
        actual: countsByRisk[risk],
        maximum
      });
    }
  }
  return { passed: violations.length === 0, consideredFindings: considered.length, countsByRisk, violations };
}

function countRisks(findings: readonly FilteredZapFinding[]): Record<ZapRisk, number> {
  const counts: Record<ZapRisk, number> = { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const item of findings) counts[item.finding.risk]++;
  return counts;
}

function validateBudget(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${name} must be a non-negative integer`);
}
