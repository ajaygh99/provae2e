import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StudioRunService, type StudioSpawnRequest } from '../../src/studio/studio-run-service';
import { StudioWorkspaceManager } from '../../src/studio/workspace-manager';

describe('StudioRunService', () => {
  let root = '';

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('executes a selected test with a fixed shell-free argument vector', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'studio-run-'));
    await writeFile(path.join(root, 'safe.prova.yaml'),
      'name: safe\nurl: https://example.com\nsteps:\n  - action: navigate\n');
    const manager = new StudioWorkspaceManager();
    const workspace = await manager.selectWorkspace(root);
    const [file] = await manager.listTestFiles(workspace.id);
    const calls: StudioSpawnRequest[] = [];
    const service = new StudioRunService(manager, 'C:\\trusted\\prova-cli.js', async request => {
      calls.push(request);
      request.onStdout?.('starting\n');
      request.onStderr?.('warning\n');
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    });

    const started = await service.startRun({
      workspaceId: workspace.id,
      fileId: file!.id,
      browser: 'chromium',
      timeoutMs: 5_000
    });
    await new Promise(resolve => setImmediate(resolve));

    expect(started.status).toBe('running');
    expect(service.getRun(started.id).status).toBe('passed');
    expect(service.getEvents(started.id).map(event => event.type)).toEqual([
      'status', 'stdout', 'stderr', 'complete'
    ]);
    expect(calls[0]).toMatchObject({
      executable: process.execPath,
      cwd: root,
      timeoutMs: 5_000,
      args: [
        'C:\\trusted\\prova-cli.js', 'run', '--url', 'https://example.com',
        '--type', 'browser', '--browser', 'chromium', '--timeout', '5000'
      ]
    });
  });

  it.each([
    { workspaceId: 'ws_bad;calc', fileId: 'file_12345678', browser: 'chromium', timeoutMs: 5000 },
    { workspaceId: 'ws_12345678', fileId: 'file_12345678', browser: 'chromium;calc', timeoutMs: 5000 },
    { workspaceId: 'ws_12345678', fileId: 'file_12345678', browser: 'chromium', timeoutMs: 999999999 },
    { workspaceId: 'ws_12345678', fileId: 'file_12345678', browser: 'chromium', timeoutMs: 5000, command: 'calc' }
  ])('rejects untrusted request shapes %#', async request => {
    const manager = new StudioWorkspaceManager();
    const runner = jest.fn();
    const service = new StudioRunService(manager, 'cli.js', runner);
    await expect(service.startRun(request)).rejects.toThrow('Invalid Studio run request');
    expect(runner).not.toHaveBeenCalled();
  });
});
