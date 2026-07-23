import {
  captureCicdContext,
  captureTestEvidenceStages,
  captureBuildStage,
  captureDeployStage,
  evaluatePipelineGate,
  linkFailedTestToIncidents,
  type CicdMetadata
} from '../../src/core/golden-thread-cicd.js';
import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { GoldenThreadStore } from '../../src/core/golden-thread-store.js';
import { ProductionLogsStore } from '../../src/core/production-logs-store.js';
import { type LogEntry } from '../../src/core/production-logs-model.js';
import { tmpdir } from 'node:os';
import path from 'node:path';

function baseMetadata(overrides: Partial<CicdMetadata> = {}): CicdMetadata {
  return {
    commit_sha: 'abc1234def',
    branch: 'main',
    repo: 'ajaygh99/provae2e',
    run_id: '42',
    actor: 'ci-bot',
    workflow: 'ci',
    event_name: 'push',
    deployment_env: 'production',
    test_coverage: 92,
    build_status: 'success',
    ...overrides
  };
}

describe('Golden Thread CI/CD Integration', () => {
  let store: GoldenThreadStore;
  let linker: GoldenThreadLinker;

  beforeEach(async () => {
    const dbPath = path.join(tmpdir(), `test-cicd-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    store = await GoldenThreadStore.open(dbPath);
    linker = new GoldenThreadLinker(store);
  });

  describe('captureCicdContext', () => {
    it('captures metadata from GitHub Actions env vars', () => {
      const env: Record<string, string | undefined> = {
        GITHUB_SHA: 'deadbeef',
        GITHUB_REF_NAME: 'feature/x',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_RUN_ID: '99',
        GITHUB_ACTOR: 'octocat',
        GITHUB_WORKFLOW: 'Deploy',
        GITHUB_EVENT_NAME: 'deployment',
        PROVA_DEPLOY_ENV: 'staging',
        PROVA_TEST_COVERAGE: '87',
        PROVA_BUILD_STATUS: 'success'
      };
      const meta = captureCicdContext({ env });
      expect(meta.commit_sha).toBe('deadbeef');
      expect(meta.branch).toBe('feature/x');
      expect(meta.repo).toBe('owner/repo');
      expect(meta.run_id).toBe('99');
      expect(meta.actor).toBe('octocat');
      expect(meta.workflow).toBe('Deploy');
      expect(meta.event_name).toBe('deployment');
      expect(meta.deployment_env).toBe('staging');
      expect(meta.test_coverage).toBe(87);
      expect(meta.build_status).toBe('success');
    });

    it('falls back to defaults when env vars are missing', () => {
      const meta = captureCicdContext({ env: {} });
      expect(meta.commit_sha).toBe('unknown');
      expect(meta.branch).toBe('unknown');
      expect(meta.actor).toBe('github-actions');
      expect(meta.test_coverage).toBeNull();
      expect(meta.build_status).toBe('unknown');
    });

    it('strips refs/heads/ prefix from branch and clamps coverage', () => {
      const meta = captureCicdContext({
        env: { GITHUB_REF: 'refs/heads/release/1.0' },
        test_coverage: 150
      });
      expect(meta.branch).toBe('release/1.0');
      expect(meta.test_coverage).toBe(100);
    });

    it('normalizes build status aliases and honors explicit overrides', () => {
      expect(captureCicdContext({ env: { PROVA_BUILD_STATUS: 'passed' } }).build_status).toBe('success');
      expect(captureCicdContext({ env: { PROVA_BUILD_STATUS: 'failed' } }).build_status).toBe('failure');
      expect(captureCicdContext({ env: {}, build_status: 'failure' }).build_status).toBe('failure');
      expect(captureCicdContext({ env: { PROVA_TEST_COVERAGE: 'not-a-number' } }).test_coverage).toBeNull();
    });
  });

  describe('stage capture', () => {
    it('captures Test and Evidence stages as PASSED when no failures', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      await captureTestEvidenceStages(
        { golden_thread_id: id, golden_thread_linker: linker, metadata: baseMetadata() },
        { total: 10, passed: 10, failed: 0, coverage: 91, report_url: 'https://x/report' }
      );
      const chain = await linker.getChain(id);
      const test = chain!.stages.find(s => s.stage === 2);
      const evidence = chain!.stages.find(s => s.stage === 3);
      expect(test!.status).toBe('PASSED');
      expect(evidence!.status).toBe('PASSED');
      expect(JSON.parse(evidence!.metadata).test_coverage).toBe(91);
      expect(JSON.parse(evidence!.metadata).pass_rate).toBe(100);
    });

    it('captures Test/Evidence as FAILED when a test fails', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      await captureTestEvidenceStages(
        { golden_thread_id: id, golden_thread_linker: linker, metadata: baseMetadata() },
        { total: 5, passed: 3, failed: 2 }
      );
      const chain = await linker.getChain(id);
      expect(chain!.stages.find(s => s.stage === 2)!.status).toBe('FAILED');
      expect(chain!.stages.find(s => s.stage === 3)!.status).toBe('FAILED');
    });

    it('treats a zero-test run as FAILED (boundary)', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      await captureTestEvidenceStages(
        { golden_thread_id: id, golden_thread_linker: linker, metadata: baseMetadata() },
        { total: 0, passed: 0, failed: 0 }
      );
      const chain = await linker.getChain(id);
      expect(chain!.stages.find(s => s.stage === 2)!.status).toBe('FAILED');
    });

    it('captures Build stage from build status', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      await captureBuildStage({ golden_thread_id: id, golden_thread_linker: linker, metadata: baseMetadata({ build_status: 'success' }) });
      const chain = await linker.getChain(id);
      expect(chain!.stages.find(s => s.stage === 4)!.status).toBe('PASSED');
    });

    it('maps unknown build status to IN_PROGRESS', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      await captureBuildStage({ golden_thread_id: id, golden_thread_linker: linker, metadata: baseMetadata({ build_status: 'unknown' }) });
      const chain = await linker.getChain(id);
      expect(chain!.stages.find(s => s.stage === 4)!.status).toBe('IN_PROGRESS');
    });

    it('captures Deploy stage with GREEN status on success', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      await captureDeployStage({ golden_thread_id: id, golden_thread_linker: linker, metadata: baseMetadata() }, true);
      const chain = await linker.getChain(id);
      const deploy = chain!.stages.find(s => s.stage === 5);
      expect(deploy!.status).toBe('PASSED');
      expect(deploy!.deployment_status).toBe('GREEN');
      expect(JSON.parse(deploy!.deployment_metadata!).environment).toBe('production');
    });

    it('captures Deploy stage with RED status on failure', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      await captureDeployStage({ golden_thread_id: id, golden_thread_linker: linker, metadata: baseMetadata() }, false);
      const chain = await linker.getChain(id);
      expect(chain!.stages.find(s => s.stage === 5)!.deployment_status).toBe('RED');
    });

    it('propagates a typed error when the chain does not exist', async () => {
      await expect(
        captureBuildStage({ golden_thread_id: 'missing', golden_thread_linker: linker, metadata: baseMetadata() })
      ).rejects.toThrow(/not found/);
    });
  });

  describe('evaluatePipelineGate', () => {
    it('passes when Test and Evidence are PASSED', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      await captureTestEvidenceStages(
        { golden_thread_id: id, golden_thread_linker: linker, metadata: baseMetadata() },
        { total: 4, passed: 4, failed: 0 }
      );
      const chain = await linker.getChain(id);
      const gate = evaluatePipelineGate(chain!);
      expect(gate.passed).toBe(true);
      expect(gate.reasons).toHaveLength(0);
    });

    it('fails when Test/Evidence stages are missing', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      const chain = await linker.getChain(id);
      const gate = evaluatePipelineGate(chain!);
      expect(gate.passed).toBe(false);
      expect(gate.reasons).toHaveLength(2);
      expect(gate.reasons[0]).toContain('Test');
    });

    it('fails when Evidence stage is FAILED', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      await captureTestEvidenceStages(
        { golden_thread_id: id, golden_thread_linker: linker, metadata: baseMetadata() },
        { total: 4, passed: 1, failed: 3 }
      );
      const chain = await linker.getChain(id);
      const gate = evaluatePipelineGate(chain!);
      expect(gate.passed).toBe(false);
      expect(gate.reasons.some(r => r.includes('FAILED'))).toBe(true);
    });
  });

  describe('linkFailedTestToIncidents', () => {
    let logsStore: ProductionLogsStore;
    const sha = 'sha-deploy-1';

    beforeEach(async () => {
      const logsPath = path.join(tmpdir(), `test-cicd-logs-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
      logsStore = await ProductionLogsStore.open(logsPath);
      const entries: LogEntry[] = [
        { source: 'datadog', level: 'ERROR', message: 'TypeError: cannot read property id of undefined', timestamp: '2026-07-20T10:00:00Z', tags: {}, deployment_sha: sha },
        { source: 'datadog', level: 'ERROR', message: 'TypeError: cannot read property id of undefined', timestamp: '2026-07-20T11:00:00Z', tags: {}, deployment_sha: sha },
        { source: 'datadog', level: 'WARNING', message: 'Unrelated slow query detected', timestamp: '2026-07-20T12:00:00Z', tags: {}, deployment_sha: sha }
      ];
      await logsStore.ingestLogs(entries, sha);
    });

    it('links a failed test to matching production incidents', async () => {
      const links = await linkFailedTestToIncidents({
        failed_test_name: 'checkout returns order id',
        failed_test_error: 'TypeError: cannot read property id of undefined',
        deployment_sha: sha,
        logs_store: logsStore
      });
      expect(links).toHaveLength(1);
      expect(links[0].occurrence_count).toBe(2);
      expect(links[0].incident_source).toBe('datadog');
      expect(links[0].first_occurrence).toBe('2026-07-20T10:00:00.000Z');
      expect(links[0].last_occurrence).toBe('2026-07-20T11:00:00.000Z');
    });

    it('returns no links when nothing matches', async () => {
      const links = await linkFailedTestToIncidents({
        failed_test_name: 'login flow',
        failed_test_error: 'assertion timeout waiting for dashboard',
        deployment_sha: sha,
        logs_store: logsStore
      });
      expect(links).toHaveLength(0);
    });

    it('returns no links for a deployment with no logs', async () => {
      const links = await linkFailedTestToIncidents({
        failed_test_name: 'x',
        failed_test_error: 'TypeError: cannot read property id of undefined',
        deployment_sha: 'other-sha',
        logs_store: logsStore
      });
      expect(links).toHaveLength(0);
    });
  });
});
