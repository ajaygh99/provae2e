import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { graphCommand } from '../../src/cli/graph';
import { log } from '../../src/core/logger';

jest.mock('../../src/core/logger', () => ({ log: { error: jest.fn() } }));

describe('graphCommand', () => {
  const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  afterEach(() => { output.mockClear(); process.exitCode = undefined; });
  afterAll(() => output.mockRestore());

  it('writes requirement query JSON for scripts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-graph-cli-'));
    const file = path.join(directory, 'graph.json');
    await writeFile(file, JSON.stringify({
      nodes: [
        { id: 'PROJ-1', type: 'requirement', label: 'Login' },
        { id: 'PROJ-2', type: 'requirement', label: 'Logout' },
        { id: 'test-1', type: 'test', label: 'login.spec.ts' },
        { id: 'incident-1', type: 'incident', label: 'Login outage' }
      ],
      edges: [
        { from: 'PROJ-1', to: 'test-1', relationship: 'covered-by' },
        { from: 'test-1', to: 'incident-1', relationship: 'related-to' }
      ]
    }));
    await graphCommand({ requirement: 'PROJ-1', database: file });
    expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toMatchObject({ root: { id: 'PROJ-1' } });
    output.mockClear();
    await graphCommand({ incident: 'incident-1', database: file });
    expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toMatchObject({ root: { id: 'incident-1' } });
    output.mockClear();
    await graphCommand({ test: 'test-1', database: file });
    expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toMatchObject({ test: { id: 'test-1' } });
    output.mockClear();
    await graphCommand({ suggestions: true, database: file });
    expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toEqual([
      expect.objectContaining({ requirementId: 'PROJ-2' })
    ]);
  });

  it('rejects ambiguous actions and reports loading errors', async () => {
    await graphCommand({ requirement: 'one', incident: 'two', database: 'missing' });
    expect(process.exitCode).toBe(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('exactly one'));
    process.exitCode = undefined;
    await graphCommand({ database: 'missing' });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    await graphCommand({ incident: 'one', database: 'missing' });
    expect(process.exitCode).toBe(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Unable to load'));
  });
});
