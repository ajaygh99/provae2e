import { parseZapJsonReport } from '../../src/core/zap-report-parser';

function report(): string {
  return JSON.stringify({
    site: [{
      '@name': 'https://example.com',
      alerts: [{
        pluginid: '10021',
        alert: 'X-Content-Type-Options Header Missing',
        riskcode: '1',
        riskdesc: 'Low (Medium)',
        cweid: '693',
        instances: [
          { uri: 'https://user:secret@example.com/path#fragment', param: 'header', evidence: 'token=secret-value' },
          { uri: 'https://example.com/path', param: 'header', evidence: 'token=secret-value' }
        ]
      }]
    }]
  });
}

describe('ZAP JSON report parsing', () => {
  it('normalizes, redacts, strips credentials, and deduplicates findings', () => {
    const result = parseZapJsonReport(report());
    expect(result.warnings).toEqual([]);
    expect(result.findings).toEqual([{
      alertId: '10021',
      name: 'X-Content-Type-Options Header Missing',
      risk: 'LOW',
      cwe: 'CWE-693',
      url: 'https://example.com/path',
      parameter: 'header',
      evidence: 'token=[REDACTED]'
    }]);
  });

  it('warns about malformed entries instead of accepting unsafe URLs', () => {
    const result = parseZapJsonReport(JSON.stringify({
      site: [
        { alerts: [{ pluginid: '1', alert: 'Unsafe', riskcode: 3, instances: [{ uri: 'file:///etc/passwd' }] }] },
        { alerts: 'invalid' }
      ]
    }));
    expect(result.findings).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });

  it('rejects invalid, unsupported, and oversized reports', () => {
    expect(() => parseZapJsonReport('{')).toThrow('Invalid ZAP JSON');
    expect(() => parseZapJsonReport('{}')).toThrow('site array');
    expect(() => parseZapJsonReport(' '.repeat(10 * 1024 * 1024 + 1))).toThrow('safety limit');
  });
});
