import { evaluateZapScanPolicy } from '../../src/core/zap-scan-policy';
import type { FilteredZapFinding, ZapFinding, ZapScanResult } from '../../src/core/zap-false-positive-filter';

function item(risk: ZapFinding['risk'], isNew = true): FilteredZapFinding {
  const finding = { alertId: risk, name: `${risk} finding`, risk, url: `https://example.com/${risk}` };
  return { finding, findingKey: risk, isNew, disposition: 'visible' };
}

function scan(visible: FilteredZapFinding[], newFindings = visible.filter((value) => value.isNew)): ZapScanResult {
  return {
    scanId: 'scan-1', target: 'test', scannedAt: '2026-07-29T00:00:00.000Z',
    baselineEstablished: false, visible, filtered: [], newFindings
  };
}

describe('ZAP scan policy', () => {
  it('fails new medium-or-higher findings by default', () => {
    const result = evaluateZapScanPolicy(scan([item('LOW'), item('HIGH')]));
    expect(result.passed).toBe(false);
    expect(result.consideredFindings).toBe(1);
    expect(result.countsByRisk.HIGH).toBe(1);
  });

  it('supports reviewed budgets and all-visible evaluation', () => {
    const result = evaluateZapScanPolicy(scan([item('HIGH', false), item('CRITICAL')]), {
      minimumRisk: 'LOW',
      newFindingsOnly: false,
      maximumFindings: 2,
      maximumByRisk: { HIGH: 1, CRITICAL: 1 }
    });
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('reports deterministic total and per-risk violations', () => {
    const result = evaluateZapScanPolicy(scan([item('HIGH'), item('CRITICAL')]), {
      maximumFindings: 1,
      maximumByRisk: { CRITICAL: 0 }
    });
    expect(result.violations.map((violation) => violation.code)).toEqual(['finding-budget', 'risk-budget']);
  });

  it('rejects invalid budgets and thresholds', () => {
    expect(() => evaluateZapScanPolicy(scan([]), { maximumFindings: -1 })).toThrow('non-negative integer');
    expect(() => evaluateZapScanPolicy(scan([]), { minimumRisk: 'UNKNOWN' as ZapFinding['risk'] })).toThrow('minimumRisk');
  });
});
