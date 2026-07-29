import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StudioWorkspaceManager } from '../../src/studio/workspace-manager';

describe('StudioWorkspaceManager', () => {
  it('selects a directory and returns opaque browser-safe metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-studio-workspace-'));
    const manager = new StudioWorkspaceManager();
    const workspace = await manager.selectWorkspace(root);

    expect(workspace).toEqual({
      id: expect.stringMatching(/^ws_[A-Za-z0-9_-]{24}$/),
      name: path.basename(root),
      testFileCount: 0
    });
    expect(JSON.stringify(workspace)).not.toContain(await realpath(root));
    expect(manager.getWorkspaceRoot(workspace.id)).toBe(await realpath(root));
  });

  it('returns the same id when the same canonical directory is selected twice', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-studio-workspace-'));
    const manager = new StudioWorkspaceManager();
    const first = await manager.selectWorkspace(root);
    const second = await manager.selectWorkspace(path.join(root, '.'));
    expect(second.id).toBe(first.id);
  });

  it('rejects missing paths, files, roots, and unknown ids', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-studio-workspace-'));
    const file = path.join(root, 'not-a-directory.txt');
    await writeFile(file, 'no');
    const manager = new StudioWorkspaceManager();

    await expect(manager.selectWorkspace('')).rejects.toThrow('required');
    await expect(manager.selectWorkspace(path.join(root, 'missing'))).rejects.toThrow('does not exist');
    await expect(manager.selectWorkspace(file)).rejects.toThrow('must be a directory');
    await expect(manager.selectWorkspace(path.parse(root).root)).rejects.toThrow('filesystem root');
    expect(() => manager.getWorkspace('ws_unknown')).toThrow('not found');
  });
});

