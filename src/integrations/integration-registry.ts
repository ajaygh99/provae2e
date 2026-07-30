import {
  sanitizeIntegrationResult,
  validateIntegrationInput,
  validateIntegrationManifest,
  type ApprovedIntegrationId,
  type IntegrationAction,
  type IntegrationExecutionResult,
  type IntegrationHealth,
  type IntegrationManifest
} from './integration-contract.js';

export interface IntegrationExecutionContext {
  signal: AbortSignal;
  getSecret(name: string): string;
}

export interface IntegrationAdapter {
  readonly manifest: IntegrationManifest;
  initialize(): Promise<void>;
  health(): Promise<IntegrationHealth>;
  execute(
    action: IntegrationAction,
    input: Record<string, unknown>,
    context: IntegrationExecutionContext
  ): Promise<IntegrationExecutionResult>;
  dispose(): Promise<void>;
}

export class IntegrationRegistry {
  private readonly adapters = new Map<ApprovedIntegrationId, IntegrationAdapter>();

  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = process.env) {}

  async register(adapter: IntegrationAdapter): Promise<void> {
    const manifest = validateIntegrationManifest(adapter.manifest);
    if (this.adapters.has(manifest.id)) {
      throw new Error(`Integration ${manifest.id} is already registered`);
    }
    await adapter.initialize();
    this.adapters.set(manifest.id, adapter);
  }

  list(): Array<{ id: ApprovedIntegrationId; owner: string; actions: IntegrationAction[] }> {
    return [...this.adapters.values()].map(({ manifest }) => ({
      id: manifest.id,
      owner: manifest.owner,
      actions: [...manifest.actions]
    }));
  }

  async health(id: ApprovedIntegrationId): Promise<IntegrationHealth> {
    const adapter = this.require(id);
    return adapter.health();
  }

  async execute(
    id: ApprovedIntegrationId,
    action: IntegrationAction,
    input: Record<string, unknown>
  ): Promise<IntegrationExecutionResult> {
    const adapter = this.require(id);
    const manifest = validateIntegrationManifest(adapter.manifest);
    if (!manifest.actions.includes(action)) {
      throw new Error(`Integration ${id} does not declare action ${action}`);
    }
    const validatedInput = validateIntegrationInput(input);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Integration ${id} timed out after ${manifest.timeoutMs} ms`));
      }, manifest.timeoutMs);
    });
    const context: IntegrationExecutionContext = {
      signal: controller.signal,
      getSecret: (name) => {
        const reference = manifest.secretRefs[name];
        if (!reference) {
          throw new Error(`Integration ${id} did not declare secret ${name}`);
        }
        const variable = reference.slice('env:'.length);
        const value = this.environment[variable];
        if (!value) {
          throw new Error(`Required integration secret ${variable} is unavailable`);
        }
        return value;
      }
    };
    try {
      const result = await Promise.race([
        adapter.execute(action, validatedInput, context),
        timeout
      ]);
      return sanitizeIntegrationResult(result);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async unregister(id: ApprovedIntegrationId): Promise<void> {
    const adapter = this.require(id);
    try {
      await adapter.dispose();
    } finally {
      this.adapters.delete(id);
    }
  }

  async disposeAll(): Promise<void> {
    const failures: string[] = [];
    for (const id of [...this.adapters.keys()]) {
      try {
        await this.unregister(id);
      } catch (error) {
        failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Integration cleanup failed: ${failures.join('; ')}`);
    }
  }

  private require(id: ApprovedIntegrationId): IntegrationAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Integration ${id} is not registered`);
    }
    return adapter;
  }
}
