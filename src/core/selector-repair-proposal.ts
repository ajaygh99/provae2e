/** Auditable repair proposals; this module never edits test source automatically. */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SelectorDescriptor, SelectorTier } from './self-healing-selector.js';

export interface SelectorRepairProposal {
  version: 1;
  status: 'PENDING_HUMAN_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ROLLED_BACK';
  pageKey: string;
  intentKey: string;
  previous: SelectorDescriptor;
  proposed: SelectorDescriptor;
  tier: SelectorTier;
  confidence: number;
  successfulRuns: number;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

/** Creates a data-only proposal that cannot silently modify source code. */
export function createSelectorRepairProposal(input: Omit<SelectorRepairProposal, 'version' | 'status' | 'createdAt'>): SelectorRepairProposal {
  if (input.confidence < 0 || input.confidence > 1) throw new Error('Repair confidence must be between 0 and 1');
  if (!Number.isInteger(input.successfulRuns) || input.successfulRuns < 1) throw new Error('Repair proposal requires at least one successful run');
  return { version: 1, status: 'PENDING_HUMAN_APPROVAL', ...input, createdAt: new Date().toISOString() };
}

/** Writes a review artifact; applying the proposal remains a separate human action. */
export async function writeSelectorRepairProposal(filePath: string, proposal: SelectorRepairProposal): Promise<void> {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await writeFile(filePath, JSON.stringify(proposal, null, 2), 'utf-8');
}

/** Lists valid repair proposals in a review directory. */
export async function listSelectorRepairProposals(directory: string): Promise<Array<{ id: string; proposal: SelectorRepairProposal }>> {
  try {
    const entries = (await readdir(directory)).filter(file => file.endsWith('.json')).sort();
    const proposals: Array<{ id: string; proposal: SelectorRepairProposal }> = [];
    for (const file of entries) {
      const proposal = JSON.parse(await readFile(path.join(directory, file), 'utf-8')) as SelectorRepairProposal;
      if (proposal.version === 1 && typeof proposal.status === 'string') {
        proposals.push({ id: path.basename(file, '.json'), proposal });
      }
    }
    return proposals;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return [];
    throw error;
  }
}

/** Applies a human review decision to a proposal without modifying test source. */
export async function reviewSelectorRepairProposal(
  directory: string,
  id: string,
  action: 'approve' | 'reject' | 'rollback',
  reviewedBy: string
): Promise<SelectorRepairProposal> {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error('Invalid repair proposal id');
  if (!reviewedBy.trim()) throw new Error('Reviewer identity is required');
  const filePath = path.join(path.resolve(directory), `${id}.json`);
  const proposal = JSON.parse(await readFile(filePath, 'utf-8')) as SelectorRepairProposal;
  if (action === 'rollback' && proposal.status !== 'APPROVED') {
    throw new Error('Only approved repair proposals can be rolled back');
  }
  if (action !== 'rollback' && proposal.status !== 'PENDING_HUMAN_APPROVAL') {
    throw new Error('Only pending repair proposals can be approved or rejected');
  }
  const updated: SelectorRepairProposal = {
    ...proposal,
    status: action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'ROLLED_BACK',
    reviewedAt: new Date().toISOString(),
    reviewedBy
  };
  await writeSelectorRepairProposal(filePath, updated);
  return updated;
}

/** Deletes proposal artifacts and returns the number removed. */
export async function clearSelectorRepairProposals(directory: string): Promise<number> {
  const proposals = await listSelectorRepairProposals(directory);
  for (const proposal of proposals) await rm(path.join(path.resolve(directory), `${proposal.id}.json`), { force: true });
  return proposals.length;
}
