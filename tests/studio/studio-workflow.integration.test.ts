import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createStudioHttpServer, listenStudioLoopback } from '../../src/studio/studio-http-server';
import { StudioRunService } from '../../src/studio/studio-run-service';
import { StudioWorkspaceManager } from '../../src/studio/workspace-manager';

describe('Studio loopback workflow', () => {
  let root = '';
  let server: Server;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('selects, discovers, reads, saves, runs, streams, and retrieves evidence', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'studio-workflow-'));
    await writeFile(path.join(root, 'checkout.prova.yaml'),
      'name: checkout\nurl: https://example.com\nsteps:\n  - action: navigate\n');
    const workspaces = new StudioWorkspaceManager();
    const runs = new StudioRunService(workspaces, 'trusted-cli.js', async request => {
      request.onStdout?.('browser started\n');
      return { exitCode: 0, stdout: 'browser passed\n', stderr: '' };
    });
    server = createStudioHttpServer(runs, workspaces);
    const address = await listenStudioLoopback(server);
    const api = `http://${address.host}:${address.port}/api/studio/v1`;
    const jsonHeaders = { 'content-type': 'application/json' };

    const workspace = await json(`${api}/workspaces/select`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ path: root })
    }) as { id: string };
    const files = await json(`${api}/workspaces/${workspace.id}/files`) as { id: string }[];
    expect(files).toHaveLength(1);
    const documentUrl = `${api}/workspaces/${workspace.id}/files/${files[0]!.id}`;
    const document = await json(documentUrl) as { content: string; revision: string };
    const updated = document.content.replace('name: checkout', 'name: checkout updated');
    const saved = await json(documentUrl, {
      method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify({ content: updated, expectedRevision: document.revision })
    }) as { content: string; revision: string };
    expect(saved.content).toContain('checkout updated');
    expect(saved.revision).not.toBe(document.revision);

    const run = await json(`${api}/runs`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({
        workspaceId: workspace.id, fileId: files[0]!.id, browser: 'chromium', timeoutMs: 5_000
      })
    }) as { id: string };
    await new Promise(resolve => setTimeout(resolve, 10));
    const summary = await json(`${api}/runs/${run.id}`) as { status: string };
    expect(summary.status).toBe('passed');
    const stream = await (await fetch(`${api}/runs/${run.id}/events`)).text();
    expect(stream).toContain('browser started');
    expect(stream).toContain('event: complete');
    const evidence = await json(`${api}/runs/${run.id}/evidence`) as { kind: string }[];
    expect(evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'log' })]));
  });
});

async function json(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  expect(response.ok).toBe(true);
  return response.json() as Promise<unknown>;
}
