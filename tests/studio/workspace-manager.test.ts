import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
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

  it('lists only supported test definitions and does not follow symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-studio-workspace-'));
    await mkdir(path.join(root, 'tests', 'nested'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'hidden'), { recursive: true });
    await writeFile(path.join(root, 'tests', 'checkout.prova.yaml'), 'name: checkout');
    await writeFile(path.join(root, 'tests', 'nested', 'api.spec.json'), '{}');
    await writeFile(path.join(root, 'tests', 'notes.md'), 'ignore');
    await writeFile(path.join(root, 'package.json'), '{}');
    await writeFile(path.join(root, 'node_modules', 'hidden', 'bad.test.json'), '{}');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'prova-studio-outside-'));
    await writeFile(path.join(outside, 'escaped.prova.yaml'), 'name: escaped');
    await symlink(outside, path.join(root, 'tests', 'linked'), 'junction');

    const manager = new StudioWorkspaceManager();
    const workspace = await manager.selectWorkspace(root);
    const files = await manager.listTestFiles(workspace.id);

    expect(files.map(file => file.relativePath)).toEqual([
      'tests/checkout.prova.yaml',
      'tests/nested/api.spec.json'
    ]);
    expect(files.every(file => !JSON.stringify(file).includes(root))).toBe(true);
    expect(manager.getWorkspace(workspace.id).testFileCount).toBe(2);
  });

  it('reads and atomically saves a discovered document using its revision', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-studio-workspace-'));
    const definition = path.join(root, 'checkout.prova.yaml');
    await writeFile(definition, [
      'name: checkout',
      'url: https://example.com',
      'steps:',
      '  - action: navigate',
      ''
    ].join('\n'));
    const manager = new StudioWorkspaceManager();
    const workspace = await manager.selectWorkspace(root);
    const [file] = await manager.listTestFiles(workspace.id);

    const original = await manager.readTestDocument(workspace.id, file!.id);
    expect(original.diagnostics).toEqual([]);
    expect(original.revision).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const saved = await manager.saveTestDocument(
      workspace.id,
      file!.id,
      [
        'name: checkout-updated',
        'url: https://example.com',
        'steps:',
        '  - action: navigate',
        ''
      ].join('\n'),
      original.revision
    );
    expect(saved.content).toContain('name: checkout-updated');
    expect(saved.revision).not.toBe(original.revision);
  });

  it('returns diagnostics on read and rejects invalid saves', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-studio-workspace-'));
    await writeFile(path.join(root, 'broken.prova.json'), '{"name":"","steps":[]}');
    const manager = new StudioWorkspaceManager();
    const workspace = await manager.selectWorkspace(root);
    const [file] = await manager.listTestFiles(workspace.id);
    const current = await manager.readTestDocument(workspace.id, file!.id);

    expect(current.diagnostics.map(diagnostic => diagnostic.path)).toEqual([
      '$.name',
      '$.url',
      '$.steps'
    ]);
    await expect(manager.saveTestDocument(
      workspace.id,
      file!.id,
      '{"name":"still invalid"}',
      current.revision
    )).rejects.toMatchObject({
      name: 'StudioDocumentValidationError',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ path: '$.url' })
      ])
    });
  });

  it('rejects stale revisions and undiscovered file ids', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-studio-workspace-'));
    await writeFile(path.join(root, 'checkout.prova.json'), '{"name":"checkout"}\n');
    const manager = new StudioWorkspaceManager();
    const workspace = await manager.selectWorkspace(root);
    const [file] = await manager.listTestFiles(workspace.id);

    await expect(manager.saveTestDocument(
      workspace.id,
      file!.id,
      '{}',
      'stale-revision'
    )).rejects.toThrow('changed on disk');
    await expect(manager.readTestDocument(workspace.id, 'file_unknown')).rejects.toThrow('not found');
  });
});
