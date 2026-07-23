import {
  formatGoldenThreadSummary,
  isDeploySuccessful,
  createFetchSlackSender,
  postGoldenThreadSummary,
  type SlackSender,
  type FetchLike
} from '../../src/core/golden-thread-slack.js';
import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { GoldenThreadStore } from '../../src/core/golden-thread-store.js';
import { captureDeployStage, type CicdMetadata } from '../../src/core/golden-thread-cicd.js';
import { tmpdir } from 'node:os';
import path from 'node:path';

function metadata(): CicdMetadata {
  return {
    commit_sha: 'abc1234',
    branch: 'main',
    repo: 'ajaygh99/provae2e',
    run_id: '7',
    actor: 'ci-bot',
    workflow: 'ci',
    event_name: 'push',
    deployment_env: 'production',
    test_coverage: 90,
    build_status: 'success'
  };
}

describe('Golden Thread Slack Notifications', () => {
  let store: GoldenThreadStore;
  let linker: GoldenThreadLinker;

  beforeEach(async () => {
    const dbPath = path.join(tmpdir(), `test-slack-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    store = await GoldenThreadStore.open(dbPath);
    linker = new GoldenThreadLinker(store);
  });

  async function chainWithDeploy(deployed: boolean): Promise<string> {
    const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
    await captureDeployStage({ golden_thread_id: id, golden_thread_linker: linker, metadata: metadata() }, deployed);
    return id;
  }

  describe('isDeploySuccessful', () => {
    it('returns true for a PASSED/GREEN deploy stage', async () => {
      const chain = await linker.getChain(await chainWithDeploy(true));
      expect(isDeploySuccessful(chain!)).toBe(true);
    });

    it('returns false for a failed deploy', async () => {
      const chain = await linker.getChain(await chainWithDeploy(false));
      expect(isDeploySuccessful(chain!)).toBe(false);
    });

    it('returns false when there is no deploy stage', async () => {
      const id = await linker.initiateChain({ actor: 'spec', artifact_url: 'https://x/spec' });
      const chain = await linker.getChain(id);
      expect(isDeploySuccessful(chain!)).toBe(false);
    });
  });

  describe('formatGoldenThreadSummary', () => {
    it('produces text and blocks summarizing all 7 stages', async () => {
      const chain = await linker.getChain(await chainWithDeploy(true));
      const msg = formatGoldenThreadSummary(chain!);
      expect(msg.text).toContain('Deployment Successful');
      expect(msg.text).toContain(chain!.golden_thread_id);
      expect(msg.blocks).toHaveLength(3);
      // 7 stage lines in the section block text.
      const section = msg.blocks![2] as { text: { text: string } };
      expect(section.text.text.split('\n')).toHaveLength(7);
    });

    it('uses the update headline when deploy is not successful', async () => {
      const chain = await linker.getChain(await chainWithDeploy(false));
      const msg = formatGoldenThreadSummary(chain!);
      expect(msg.text).toContain('Deployment Update');
    });
  });

  describe('postGoldenThreadSummary', () => {
    it('skips posting when deploy not successful and gating enabled', async () => {
      const chain = await linker.getChain(await chainWithDeploy(false));
      const sender: SlackSender = jest.fn();
      const result = await postGoldenThreadSummary({ chain: chain!, webhookUrl: 'https://hook', sender });
      expect(result.skipped).toBe(true);
      expect(result.sent).toBe(false);
      expect(sender).not.toHaveBeenCalled();
    });

    it('posts on a successful deploy using the injected sender', async () => {
      const chain = await linker.getChain(await chainWithDeploy(true));
      const sender: SlackSender = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      const result = await postGoldenThreadSummary({ chain: chain!, webhookUrl: 'https://hook', sender });
      expect(result.sent).toBe(true);
      expect(sender).toHaveBeenCalledWith('https://hook', expect.objectContaining({ text: expect.any(String) }));
    });

    it('resolves the webhook from env when not passed', async () => {
      const chain = await linker.getChain(await chainWithDeploy(true));
      const sender: SlackSender = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      const result = await postGoldenThreadSummary({
        chain: chain!,
        sender,
        env: { SLACK_WEBHOOK_URL: 'https://env-hook' }
      });
      expect(result.sent).toBe(true);
      expect(sender).toHaveBeenCalledWith('https://env-hook', expect.anything());
    });

    it('throws when no webhook URL is configured', async () => {
      const chain = await linker.getChain(await chainWithDeploy(true));
      await expect(
        postGoldenThreadSummary({ chain: chain!, sender: jest.fn(), env: {} })
      ).rejects.toThrow(/webhook URL not configured/);
    });

    it('reports a failed delivery without throwing', async () => {
      const chain = await linker.getChain(await chainWithDeploy(true));
      const sender: SlackSender = jest.fn().mockResolvedValue({ ok: false, status: 500, error: 'boom' });
      const result = await postGoldenThreadSummary({ chain: chain!, webhookUrl: 'https://hook', sender });
      expect(result.sent).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.result?.status).toBe(500);
    });

    it('can post regardless of deploy status when gating disabled', async () => {
      const chain = await linker.getChain(await chainWithDeploy(false));
      const sender: SlackSender = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      const result = await postGoldenThreadSummary({
        chain: chain!,
        webhookUrl: 'https://hook',
        sender,
        onlyOnSuccessfulDeploy: false
      });
      expect(result.sent).toBe(true);
    });
  });

  describe('createFetchSlackSender', () => {
    it('POSTs JSON and reports success', async () => {
      const fetchImpl: FetchLike = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      const sender = createFetchSlackSender(fetchImpl);
      const result = await sender('https://hook', { text: 'hi' });
      expect(result.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hook',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'hi' }) })
      );
    });

    it('maps a non-ok response to an error', async () => {
      const fetchImpl: FetchLike = jest.fn().mockResolvedValue({ ok: false, status: 404 });
      const sender = createFetchSlackSender(fetchImpl);
      const result = await sender('https://hook', { text: 'hi' });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('404');
    });

    it('catches network errors and returns status 0', async () => {
      const fetchImpl: FetchLike = jest.fn().mockRejectedValue(new Error('network down'));
      const sender = createFetchSlackSender(fetchImpl);
      const result = await sender('https://hook', { text: 'hi' });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
      expect(result.error).toContain('network down');
    });
  });
});
