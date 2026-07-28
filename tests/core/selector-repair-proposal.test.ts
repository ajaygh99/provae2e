import { createSelectorRepairProposal, writeSelectorRepairProposal } from '../../src/core/selector-repair-proposal';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('selector repair proposals', () => {
  it('creates a human-approval artifact without modifying source', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-repair-'));
    const output = path.join(directory, 'proposal.json');
    try {
      const proposal = createSelectorRepairProposal({
        pageKey: '/checkout', intentKey: 'submit-order',
        previous: { testId: 'submit' }, proposed: { testId: 'submit-order' },
        tier: 'data-testid', confidence: 0.95, successfulRuns: 5
      });
      await writeSelectorRepairProposal(output, proposal);
      expect(JSON.parse(await readFile(output, 'utf-8'))).toMatchObject({
        status: 'PENDING_HUMAN_APPROVAL', confidence: 0.95
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects invalid confidence and unproven repairs', () => {
    expect(() => createSelectorRepairProposal({
      pageKey: '/', intentKey: 'x', previous: {}, proposed: { text: 'x' },
      tier: 'text-content', confidence: 1.1, successfulRuns: 1
    })).toThrow('confidence');
    expect(() => createSelectorRepairProposal({
      pageKey: '/', intentKey: 'x', previous: {}, proposed: { text: 'x' },
      tier: 'text-content', confidence: 0.9, successfulRuns: 0
    })).toThrow('successful run');
  });
});
