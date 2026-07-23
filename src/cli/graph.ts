/** CLI adapter for knowledge graph requirement and incident queries. */
import { KnowledgeGraphIntegration } from '../core/knowledge-graph-integration.js';
import { log } from '../core/logger.js';

export interface GraphCommandOptions {
  requirement?: string;
  incident?: string;
  test?: string;
  suggestions?: boolean;
  database: string;
}

/**
 * Executes a graph query and writes JSON for scripting.
 * @param options Parsed CLI options.
 */
export async function graphCommand(options: GraphCommandOptions): Promise<void> {
  const actions = [options.requirement, options.incident, options.test, options.suggestions ? 'suggestions' : undefined].filter(Boolean);
  if (actions.length !== 1) {
    log.error('Choose exactly one graph query: --requirement, --incident, --test, or --suggestions');
    process.exitCode = 1;
    return;
  }
  try {
    const graph = await KnowledgeGraphIntegration.fromFile(options.database);
    const result = options.requirement
      ? graph.testsForRequirement(options.requirement)
      : options.incident
        ? graph.incidentChain(options.incident)
        : options.test
          ? graph.testHistory(options.test)
          : graph.coverageSuggestions();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
