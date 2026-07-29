import {
  buildZapSecurityReport,
  createZapJiraSecurityStory,
  renderZapSecurityJson,
  renderZapSecurityMarkdown
} from '../../src/reporters/zap-security-reporter';
import type { ZapScanResult } from '../../src/core/zap-false-positive-filter';
import type { ZapPolicyEvaluation } from '../../src/core/zap-scan-policy';

const scan: ZapScanResult = {
  scanId: 'prod-1780000000000',
  target: 'prod',
  scannedAt: '2026-07-29T00:00:00.000Z',
  baselineEstablished: false,
  visible: [{
    findingKey: '40012|cwe-79|url|q',
    finding: {
      alertId: '40012',
      name: 'Cross | Site Scripting',
      risk: 'HIGH',
      cwe: 'CWE-79',
      parameter: 'q',
      url: 'https://user:secret@example.test/search?q=secret#private',
      evidence: 'authorization: should-not-appear'
    },
    isNew: true,
    disposition: 'visible'
  }],
  filtered: [{
    findingKey: '10020||url|',
    finding: {
      alertId: '10020',
      name: 'Missing header',
      risk: 'LOW',
      url: 'https://example.test/'
    },
    isNew: false,
    disposition: 'whitelisted',
    reason: 'Compensating control'
  }],
  newFindings: []
};

const policy: ZapPolicyEvaluation = {
  passed: false,
  consideredFindings: 1,
  countsByRisk: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 },
  violations: [{
    code: 'finding-budget',
    message: '1 qualifying finding(s) exceed the allowed total of 0',
    actual: 1,
    maximum: 0
  }]
};

describe('ZAP security reporting', () => {
  it('builds a deterministic share-safe report without evidence or URL secrets', () => {
    const report = buildZapSecurityReport(scan, policy);
    expect(report).toMatchObject({
      schemaVersion: 1,
      summary: { passed: false, visible: 1, filtered: 1, consideredFindings: 1 }
    });
    expect(report.findings.map(finding => finding.risk)).toEqual(['HIGH', 'LOW']);
    const json = renderZapSecurityJson(report);
    expect(json.endsWith('\n')).toBe(true);
    expect(json).toContain('q=%5BREDACTED%5D');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('should-not-appear');
  });

  it('renders policy violations and bounds Markdown finding details', () => {
    const markdown = renderZapSecurityMarkdown(buildZapSecurityReport(scan, policy), 1);
    expect(markdown).toContain('Status: **FAIL**');
    expect(markdown).toContain('Policy violations');
    expect(markdown).toContain('Cross \\| Site Scripting');
    expect(markdown).toContain('1 additional finding(s) omitted');
    expect(() => renderZapSecurityMarkdown(buildZapSecurityReport(scan, policy), -1)).toThrow(
      'non-negative integer'
    );
  });

  it('creates a structured Jira story draft without publishing it', () => {
    expect(createZapJiraSecurityStory(buildZapSecurityReport(scan, policy))).toMatchObject({
      summary: '[Security] ZAP policy failure for prod',
      labels: ['security', 'owasp-zap', 'security-scan-fail'],
      priority: 'High'
    });
  });
});
