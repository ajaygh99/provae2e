import type { Server } from 'node:http';
import { createStudioHttpServer, listenStudioLoopback } from '../../src/studio/studio-http-server';
import type { StudioRunService } from '../../src/studio/studio-run-service';

describe('Studio loopback HTTP API', () => {
  let server: Server;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('binds to loopback and returns a run id with 202', async () => {
    const summary = {
      id: 'run_1234567890abcdef',
      workspaceId: 'ws_12345678',
      fileId: 'file_12345678',
      status: 'running' as const
    };
    const runs = {
      startRun: jest.fn().mockResolvedValue(summary),
      getRun: jest.fn().mockReturnValue({ ...summary, status: 'passed' })
    } as unknown as StudioRunService;
    server = createStudioHttpServer(runs);
    const address = await listenStudioLoopback(server);
    expect(address.host).toBe('127.0.0.1');

    const response = await fetch(`http://${address.host}:${address.port}/api/studio/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://${address.host}:${address.port}` },
      body: JSON.stringify({
        workspaceId: 'ws_12345678', fileId: 'file_12345678', browser: 'chromium', timeoutMs: 5000
      })
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(summary);
  });

  it('rejects foreign browser origins and non-JSON requests', async () => {
    const runs = { startRun: jest.fn() } as unknown as StudioRunService;
    server = createStudioHttpServer(runs);
    const address = await listenStudioLoopback(server);
    const endpoint = `http://${address.host}:${address.port}/api/studio/v1/runs`;

    const foreign = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: '{}'
    });
    const wrongType = await fetch(endpoint, { method: 'POST', body: '{}' });
    expect(foreign.status).toBe(403);
    expect(wrongType.status).toBe(415);
    expect(runs.startRun).not.toHaveBeenCalled();
  });

  it('streams ordered run events as server-sent events', async () => {
    const events = [
      { type: 'status', sequence: 0, timestamp: '2026-07-28T00:00:00.000Z', status: 'running' },
      { type: 'stdout', sequence: 1, timestamp: '2026-07-28T00:00:01.000Z', text: 'hello\n' },
      { type: 'complete', sequence: 2, timestamp: '2026-07-28T00:00:02.000Z',
        summary: { id: 'run_1234567890abcdef', workspaceId: 'ws_12345678', fileId: 'file_12345678', status: 'passed' } }
    ];
    const runs = {
      getEvents: jest.fn().mockReturnValue(events),
      subscribe: jest.fn()
    } as unknown as StudioRunService;
    server = createStudioHttpServer(runs);
    const address = await listenStudioLoopback(server);
    const response = await fetch(
      `http://${address.host}:${address.port}/api/studio/v1/runs/run_1234567890abcdef/events`
    );
    const body = await response.text();
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('id: 1\nevent: stdout');
    expect(body).toContain('"text":"hello\\n"');
    expect(body).toContain('event: complete');
  });

  it('cancels a queued or running job through DELETE', async () => {
    const summary = {
      id: 'run_1234567890abcdef', workspaceId: 'ws_12345678',
      fileId: 'file_12345678', status: 'cancelled' as const
    };
    const runs = { cancelRun: jest.fn().mockReturnValue(summary) } as unknown as StudioRunService;
    server = createStudioHttpServer(runs);
    const address = await listenStudioLoopback(server);
    const response = await fetch(
      `http://${address.host}:${address.port}/api/studio/v1/runs/${summary.id}`,
      { method: 'DELETE' }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
  });
});
