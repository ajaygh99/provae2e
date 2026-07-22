/** High-level Golden Thread chain operations. */
import { GoldenThreadStore, type Stage, type StageStatus, type GoldenThreadChain } from './golden-thread-store.js';

/** Options for linking a stage to a chain. */
export interface LinkStageOptions {
  golden_thread_id: string;
  stage: Stage;
  status: StageStatus;
  actor: string;
  artifact_url: string;
  metadata?: Record<string, unknown>;
}

/** Options for initiating a new chain. */
export interface InitiateChainOptions {
  actor: string;
  artifact_url: string;
  metadata?: Record<string, unknown>;
}

/** Orchestrates Golden Thread chain operations. */
export class GoldenThreadLinker {
  constructor(private readonly store: GoldenThreadStore) {}

  /**
   * Initiates a new Golden Thread chain with the Spec (stage 1) artifact.
   * @param opts Chain initiation options
   * @returns The generated golden_thread_id
   */
  async initiateChain(opts: InitiateChainOptions): Promise<string> {
    return this.store.initiate(opts.actor, opts.artifact_url, opts.metadata);
  }

  /**
   * Links a new stage to an existing chain, validating the parent link.
   * @param opts Stage linking options
   */
  async linkStage(opts: LinkStageOptions): Promise<void> {
    return this.store.linkStage(
      opts.golden_thread_id,
      opts.stage,
      opts.status,
      opts.actor,
      opts.artifact_url,
      opts.metadata
    );
  }

  /**
   * Retrieves the complete chain for a golden thread ID.
   * @param golden_thread_id The chain ID
   * @returns The complete chain with all 7 stages, or null if not found
   */
  async getChain(golden_thread_id: string): Promise<GoldenThreadChain | null> {
    return this.store.getChain(golden_thread_id);
  }

  /**
   * Validates that a chain is complete and properly linked.
   * @param golden_thread_id The chain ID
   * @returns Validation result with errors if any
   */
  async validateChain(golden_thread_id: string): Promise<{ valid: boolean; errors: string[] }> {
    return this.store.validateChain(golden_thread_id);
  }

  /**
   * Lists all chains in the database.
   * @returns Array of golden_thread_ids
   */
  async listChains(): Promise<string[]> {
    return this.store.listChains();
  }
}
