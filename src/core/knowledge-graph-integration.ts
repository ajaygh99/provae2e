/** Knowledge graph queries shared by PROVA Studio and the CLI. */
import { readFile } from 'node:fs/promises';

export type GraphNodeType = 'requirement' | 'test' | 'commit' | 'deployment' | 'incident' | 'test-run';

export interface KnowledgeGraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  timestamp?: string;
  status?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface KnowledgeGraphEdge {
  from: string;
  to: string;
  relationship: 'covered-by' | 'changed-by' | 'verified-by' | 'deployed-as' | 'caused' | 'related-to';
}

export interface KnowledgeGraphDataset {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface GraphQueryResult {
  root: KnowledgeGraphNode;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface TestHistory {
  test: KnowledgeGraphNode;
  lastRun?: KnowledgeGraphNode;
  commits: KnowledgeGraphNode[];
  incidents: KnowledgeGraphNode[];
  timeline: KnowledgeGraphNode[];
}

export interface CoverageSuggestion {
  requirementId: string;
  requirement: string;
  suggestion: string;
  priority: 'high' | 'medium';
}

/** Read-only traversal facade for Studio panels and scripting queries. */
export class KnowledgeGraphIntegration {
  private readonly nodeById: Map<string, KnowledgeGraphNode>;

  /**
   * @param dataset Validated graph nodes and directed relationships.
   */
  constructor(private readonly dataset: KnowledgeGraphDataset) {
    validateDataset(dataset);
    this.nodeById = new Map(dataset.nodes.map(node => [node.id, node]));
  }

  /**
   * Loads a graph dataset from JSON.
   * @param filePath JSON dataset path.
   * @returns Queryable graph integration.
   */
  static async fromFile(filePath: string): Promise<KnowledgeGraphIntegration> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as unknown;
      return new KnowledgeGraphIntegration(parsed as KnowledgeGraphDataset);
    } catch (error) {
      throw new Error(`Unable to load knowledge graph "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Returns all tests directly covering a requirement.
   * @param requirementId Requirement key, for example PROJ-123.
   * @returns Requirement-centered graph query.
   */
  testsForRequirement(requirementId: string): GraphQueryResult {
    const root = this.requireNode(requirementId, 'requirement');
    const edges = this.dataset.edges.filter(edge => edge.from === root.id && edge.relationship === 'covered-by');
    return { root, nodes: edges.map(edge => this.requireNode(edge.to, 'test')), edges };
  }

  /**
   * Returns commits which changed a test.
   * @param testId Test node identifier.
   * @returns Test-centered code-change graph.
   */
  commitsForTest(testId: string): GraphQueryResult {
    const root = this.requireNode(testId, 'test');
    const edges = this.dataset.edges.filter(edge => edge.from === root.id && edge.relationship === 'changed-by');
    return { root, nodes: edges.map(edge => this.requireNode(edge.to, 'commit')), edges };
  }

  /**
   * Returns the complete connected chain for an incident.
   * @param incidentId Incident identifier.
   * @returns Connected code, test, deployment, run, and incident subgraph.
   */
  incidentChain(incidentId: string): GraphQueryResult {
    const root = this.requireNode(incidentId, 'incident');
    const visited = new Set([root.id]);
    const queue = [root.id];
    const edges: KnowledgeGraphEdge[] = [];
    while (queue.length) {
      const current = queue.shift() as string;
      this.dataset.edges
        .filter(edge => edge.from === current || edge.to === current)
        .forEach(edge => {
          if (!edges.includes(edge)) edges.push(edge);
          const neighbor = edge.from === current ? edge.to : edge.from;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
    }
    return {
      root,
      nodes: [...visited].filter(id => id !== root.id).map(id => this.requireNode(id)),
      edges
    };
  }

  /**
   * Builds a chronological test activity history.
   * @param testId Test node identifier.
   * @returns Runs, code changes, related incidents, and latest result.
   */
  testHistory(testId: string): TestHistory {
    const test = this.requireNode(testId, 'test');
    const related = this.incidentChainFromTest(test.id);
    const commits = related.filter(node => node.type === 'commit');
    const incidents = related.filter(node => node.type === 'incident');
    const runs = related.filter(node => node.type === 'test-run');
    const timeline = [...commits, ...incidents, ...runs]
      .filter(node => node.timestamp)
      .sort((left, right) => Date.parse(left.timestamp as string) - Date.parse(right.timestamp as string));
    return { test, lastRun: runs.sort(byNewest)[0], commits, incidents, timeline };
  }

  /**
   * Suggests tests for uncovered requirements, prioritizing incident-related gaps.
   * @returns Deterministic graph-informed coverage suggestions.
   */
  coverageSuggestions(): CoverageSuggestion[] {
    return this.dataset.nodes
      .filter(node => node.type === 'requirement')
      .filter(node => !this.dataset.edges.some(edge => edge.from === node.id && edge.relationship === 'covered-by'))
      .map(node => {
        const incidentRelated = this.dataset.edges.some(edge =>
          (edge.from === node.id || edge.to === node.id)
          && this.nodeById.get(edge.from === node.id ? edge.to : edge.from)?.type === 'incident');
        return {
          requirementId: node.id,
          requirement: node.label,
          suggestion: `Create a test covering ${node.label}`,
          priority: incidentRelated ? 'high' : 'medium'
        };
      });
  }

  private incidentChainFromTest(testId: string): KnowledgeGraphNode[] {
    const visited = new Set([testId]);
    const queue = [testId];
    while (queue.length) {
      const current = queue.shift() as string;
      this.dataset.edges.filter(edge => edge.from === current || edge.to === current).forEach(edge => {
        const neighbor = edge.from === current ? edge.to : edge.from;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      });
    }
    return [...visited].filter(id => id !== testId).map(id => this.requireNode(id));
  }

  private requireNode(id: string, type?: GraphNodeType): KnowledgeGraphNode {
    const node = this.nodeById.get(id);
    if (!node) throw new Error(`Knowledge graph node not found: ${id}`);
    if (type && node.type !== type) throw new Error(`Knowledge graph node ${id} must be a ${type}`);
    return node;
  }
}

function validateDataset(value: KnowledgeGraphDataset): void {
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('Knowledge graph requires nodes and edges arrays');
  }
  const ids = new Set<string>();
  value.nodes.forEach(node => {
    if (!node.id?.trim() || !node.label?.trim()) throw new Error('Knowledge graph nodes require id and label');
    if (ids.has(node.id)) throw new Error(`Duplicate knowledge graph node: ${node.id}`);
    ids.add(node.id);
  });
  value.edges.forEach(edge => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`Knowledge graph edge references an unknown node: ${edge.from} -> ${edge.to}`);
  });
}

function byNewest(left: KnowledgeGraphNode, right: KnowledgeGraphNode): number {
  return Date.parse(right.timestamp ?? '') - Date.parse(left.timestamp ?? '');
}
