/** Auditable repair proposals; this module never edits test source automatically. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SelectorDescriptor, SelectorTier } from './self-healing-selector.js';

export interface SelectorRepairProposal {
  version: 1;
  status: 'PENDING_HUMAN_APPROVAL';
  pageKey: string;
  intentKey: string;
  previous: SelectorDescriptor;
  proposed: SelectorDescriptor;
  tier: SelectorTier;
  confidence: number;
  successfulRuns: number;
  createdAt: string;
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
