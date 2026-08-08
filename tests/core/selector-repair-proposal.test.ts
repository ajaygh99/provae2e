import {
  clearSelectorRepairProposals,
  createSelectorRepairProposal,
  listSelectorRepairProposals,
  reviewSelectorRepairProposal,
  writeSelectorRepairProposal
} from '../../src/core/selector-repair-proposal';
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

  it('supports audited approval, rollback, rejection, listing, and clear', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-review-'));
    try {
      const proposal = createSelectorRepairProposal({
        pageKey: '/', intentKey: 'save', previous: { text: 'Save' }, proposed: { testId: 'save' },
        tier: 'data-testid', confidence: 0.97, successfulRuns: 8
      });
      await writeSelectorRepairProposal(path.join(directory, 'save.json'), proposal);
      expect(await listSelectorRepairProposals(directory)).toHaveLength(1);
      await expect(reviewSelectorRepairProposal(directory, 'save', 'approve', 'Ajay'))
        .resolves.toMatchObject({ status: 'APPROVED', reviewedBy: 'Ajay' });
      await expect(reviewSelectorRepairProposal(directory, 'save', 'rollback', 'Ajay'))
        .resolves.toMatchObject({ status: 'ROLLED_BACK' });
      await writeSelectorRepairProposal(path.join(directory, 'cancel.json'), proposal);
      await expect(reviewSelectorRepairProposal(directory, 'cancel', 'reject', 'Ajay'))
        .resolves.toMatchObject({ status: 'REJECTED' });
      expect(await clearSelectorRepairProposals(directory)).toBe(2);
      expect(await listSelectorRepairProposals(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects traversal and invalid state changes', async () => {
    await expect(reviewSelectorRepairProposal('.', '../secret', 'approve', 'Ajay')).rejects.toThrow('Invalid');
  });
});
