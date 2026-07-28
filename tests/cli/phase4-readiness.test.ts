import { buildProgram, learnReviewCommand } from '../../src/cli/run';
import { createSelectorRepairProposal, writeSelectorRepairProposal } from '../../src/core/selector-repair-proposal';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('Phase 4 readiness CLI', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('documents OpenAPI generation and selector review commands', () => {
    const program = buildProgram();
    expect(program.commands.map(command => command.name())).toEqual(expect.arrayContaining(['openapi', 'learn-review']));
    const openapi = program.commands.find(command => command.name() === 'openapi');
    expect(openapi?.options.map(option => option.long)).toEqual(expect.arrayContaining(['--path-params', '--generate-tests']));
  });

  it('records an explicit human approval through the CLI', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-cli-review-'));
    try {
      await writeSelectorRepairProposal(path.join(directory, 'save.json'), createSelectorRepairProposal({
        pageKey: '/', intentKey: 'save', previous: { text: 'Save' }, proposed: { testId: 'save' },
        tier: 'data-testid', confidence: 0.98, successfulRuns: 10
      }));
      await learnReviewCommand({
        action: 'approve', id: 'save', reviewer: 'Ajay', directory,
        database: path.join(directory, 'healing.db'), yes: false
      });
      expect(JSON.parse(await readFile(path.join(directory, 'save.json'), 'utf-8')))
        .toMatchObject({ status: 'APPROVED', reviewedBy: 'Ajay' });
      expect(process.exitCode).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires explicit confirmation before clearing learning data', async () => {
    await learnReviewCommand({
      action: 'clear', directory: '.prova/repairs', database: '.prova/healing.db', yes: false
    });
    expect(process.exitCode).toBe(1);
  });
});
