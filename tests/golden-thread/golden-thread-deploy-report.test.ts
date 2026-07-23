import {
  generateDeploymentReport,
  writeDeploymentReport
} from '../../src/reporters/golden-thread-deploy-report.js';
import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { GoldenThreadStore } from '../../src/core/golden-thread-store.js';
import {
  captureTestEvidenceStages,
  captureBuildStage,
  captureDeployStage,
  type CicdMetadata
} from '../../src/core/golden-thread-cicd.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

function metadata(overrides: Partial<CicdMetadata> = {}): CicdMetadata {
  return {
    commit_sha: 'abc1234def5678',
    branch: 'main',
    repo: 'ajaygh99/provae2e',
    run_id: '7',
    actor: 'ci-bot',
    workflow: 'ci',
    event_name: 'push',
    deployment_env: 'production',
    test_coverage: 90,
    build_status: 'success',
    ...overrides
  };
}

describe('Golden Thread Deployment Report', () => {
  let store: GoldenThreadStore;
  let linker: GoldenThreadLinker;
  let chainId: string;

  beforeEach(async () => {
    const dbPath = path.join(tmpdir(), `test-deployreport-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    store = await GoldenThreadStore.open(dbPath);
    linker = new GoldenThreadLinker(store);
    chainId = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
    const opts = { golden_thread_id: chainId, golden_thread_linker: linker, metadata: metadata() };
    await captureTestEvidenceStages(opts, { total: 3, passed: 3, failed: 0, coverage: 90 });
    await captureBuildStage(opts);
    await captureDeployStage(opts, true);
  });

  it('renders an HTML report embedding CI/CD metadata', async () => {
    const chain = await linker.getChain(chainId);
    const html = generateDeploymentReport(chain!, metadata());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('CI/CD Metadata');
    expect(html).toContain('ajaygh99/provae2e');
    expect(html).toContain('production');
    expect(html).toContain('90%');
    expect(html).toContain(chainId);
  });

  it('renders all seven stage cards with embedded evidence', async () => {
    const chain = await linker.getChain(chainId);
    const html = generateDeploymentReport(chain!, metadata());
    for (const name of ['Spec', 'Test', 'Evidence', 'Build', 'Deploy', 'Monitor', 'Debug']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('Embedded evidence');
  });

  it('shows N/A coverage when metadata coverage is null', async () => {
    const chain = await linker.getChain(chainId);
    const html = generateDeploymentReport(chain!, metadata({ test_coverage: null }));
    expect(html).toContain('N/A');
  });

  it('escapes HTML in metadata to prevent injection', async () => {
    const chain = await linker.getChain(chainId);
    const html = generateDeploymentReport(chain!, metadata({ branch: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('supports dark mode rendering', async () => {
    const chain = await linker.getChain(chainId);
    const html = generateDeploymentReport(chain!, metadata(), { darkMode: true });
    expect(html).toContain('#1e1e1e');
  });

  it('writes the report to disk', async () => {
    const chain = await linker.getChain(chainId);
    const outPath = path.join(tmpdir(), `deploy-report-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    const written = await writeDeploymentReport(chain!, metadata(), outPath);
    const contents = await readFile(written, 'utf-8');
    expect(contents).toContain('Deployment Traceability');
    expect(contents).toContain(chainId);
  });
});
