/** SQLite-backed knowledge graph querying, traversal, analytics, and REST adapter. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

/** Supported knowledge graph entity types. */
export type GraphVertexType = 'requirement' | 'code' | 'test' | 'incident' | 'service';

/** A vertex stored in the knowledge graph. */
export interface GraphVertex {
  id: string;
  type: GraphVertexType;
  name: string;
  status?: string;
  timestamp?: string;
  properties?: Record<string, unknown>;
}

/** A directed relationship between two vertices. */
export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  properties?: Record<string, unknown>;
}

/** One path through the graph. */
export interface GraphPath {
  vertices: GraphVertex[];
  edges: GraphEdge[];
}

/** Supported high-level business questions. */
export type BusinessQuestion =
  | { kind: 'tests-for-requirement'; requirementId: string }
  | { kind: 'code-for-test'; testId: string }
  | { kind: 'incidents-for-service'; serviceId: string };

/** Aggregate operation supported by the query API. */
export interface GraphAggregateQuery {
  operation: 'count' | 'average' | 'minimum' | 'maximum';
  vertexType?: GraphVertexType;
  property?: string;
}

/** Minimal request shape accepted by the REST adapter. */
export interface GraphQueryRequest {
  method: string;
  path: string;
  body?: unknown;
}

/** Minimal framework-independent REST response. */
export interface GraphQueryResponse {
  status: number;
  body: Record<string, unknown>;
}

interface CachedValue {
  value: unknown;
  expiresAt: number;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;

function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

function asProperties(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) return {};
  const parsed: unknown = JSON.parse(value);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

/** In-memory least-recently-used cache with expiration. */
export class GraphQueryCache {
  private readonly entries = new Map<string, CachedValue>();

  /** Creates an LRU cache. */
  constructor(private readonly capacity = 100, private readonly ttlMs = 60_000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Cache capacity must be a positive integer');
    if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new Error('Cache TTL must be a positive integer');
  }

  /** Reads and refreshes an entry's recency. */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  /** Inserts an entry and evicts the least-recently-used value when full. */
  set(key: string, value: unknown): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest) this.entries.delete(oldest);
    }
  }

  /** Invalidates all cached graph results. */
  clear(): void {
    this.entries.clear();
  }
}

/** Indexed SQLite graph engine intended for graphs below 100,000 vertices. */
export class KnowledgeGraphQueryEngine {
  private constructor(
    private readonly database: Database,
    private readonly cache: GraphQueryCache
  ) {}

  /** Creates an empty query engine and applies the indexed graph schema. */
  static async create(options?: { cacheCapacity?: number; cacheTtlMs?: number }): Promise<KnowledgeGraphQueryEngine> {
    const SQL = await sqlite();
    const database = new SQL.Database();
    database.run(`
      CREATE TABLE vertices (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT,
        timestamp TEXT,
        properties TEXT NOT NULL
      );
      CREATE TABLE edges (
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        relation TEXT NOT NULL,
        properties TEXT NOT NULL,
        PRIMARY KEY (source, target, relation),
        FOREIGN KEY (source) REFERENCES vertices(id),
        FOREIGN KEY (target) REFERENCES vertices(id)
      );
      CREATE INDEX idx_vertices_type ON vertices(type);
      CREATE INDEX idx_vertices_status ON vertices(status);
      CREATE INDEX idx_vertices_timestamp ON vertices(timestamp);
      CREATE INDEX idx_edges_source ON edges(source);
      CREATE INDEX idx_edges_target ON edges(target);
    `);
    return new KnowledgeGraphQueryEngine(
      database,
      new GraphQueryCache(options?.cacheCapacity, options?.cacheTtlMs)
    );
  }

  /** Adds or replaces a graph vertex. */
  addVertex(vertex: GraphVertex): void {
    if (!vertex.id.trim()) throw new Error('Vertex id is required');
    if (!vertex.name.trim()) throw new Error('Vertex name is required');
    this.database.run(
      `INSERT OR REPLACE INTO vertices (id, type, name, status, timestamp, properties)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        vertex.id,
        vertex.type,
        vertex.name,
        vertex.status ?? null,
        vertex.timestamp ?? null,
        JSON.stringify(vertex.properties ?? {})
      ]
    );
    this.cache.clear();
  }

  /** Adds or replaces a directed graph edge after validating both endpoints. */
  addEdge(edge: GraphEdge): void {
    if (!this.getVertex(edge.source)) throw new Error(`Source vertex ${edge.source} not found`);
    if (!this.getVertex(edge.target)) throw new Error(`Target vertex ${edge.target} not found`);
    if (!edge.relation.trim()) throw new Error('Edge relation is required');
    this.database.run(
      `INSERT OR REPLACE INTO edges (source, target, relation, properties) VALUES (?, ?, ?, ?)`,
      [edge.source, edge.target, edge.relation, JSON.stringify(edge.properties ?? {})]
    );
    this.cache.clear();
  }

  /** Gets a vertex by identifier. */
  getVertex(id: string): GraphVertex | undefined {
    const result = this.database.exec(
      'SELECT id, type, name, status, timestamp, properties FROM vertices WHERE id = ?',
      [id]
    );
    const row = result[0]?.values[0];
    return row ? this.mapVertex(row) : undefined;
  }

  /** Answers a predefined business traceability question. */
  answer(question: BusinessQuestion): GraphVertex[] {
    const key = `answer:${JSON.stringify(question)}`;
    const cached = this.cache.get<GraphVertex[]>(key);
    if (cached) return cached;
    const mapping = {
      'tests-for-requirement': { id: question.kind === 'tests-for-requirement' ? question.requirementId : '', type: 'test' },
      'code-for-test': { id: question.kind === 'code-for-test' ? question.testId : '', type: 'code' },
      'incidents-for-service': { id: question.kind === 'incidents-for-service' ? question.serviceId : '', type: 'incident' }
    } as const;
    const selection = mapping[question.kind];
    const paths = this.findPaths(selection.id, { targetType: selection.type, maxDepth: 4 });
    const seen = new Set<string>();
    const answer = paths.flatMap((path) => path.vertices)
      .filter((vertex) => vertex.type === selection.type && !seen.has(vertex.id) && seen.add(vertex.id));
    this.cache.set(key, answer);
    return answer;
  }

  /** Finds directed paths with breadth-first traversal and cycle protection. */
  findPaths(
    startId: string,
    options: { targetId?: string; targetType?: GraphVertexType; maxDepth?: number }
  ): GraphPath[] {
    const maxDepth = options.maxDepth ?? 4;
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 20) {
      throw new Error('maxDepth must be an integer between 1 and 20');
    }
    const start = this.getVertex(startId);
    if (!start) throw new Error(`Start vertex ${startId} not found`);
    const key = `paths:${startId}:${JSON.stringify(options)}`;
    const cached = this.cache.get<GraphPath[]>(key);
    if (cached) return cached;
    const queue: GraphPath[] = [{ vertices: [start], edges: [] }];
    const matches: GraphPath[] = [];
    while (queue.length > 0) {
      const path = queue.shift() as GraphPath;
      const current = path.vertices[path.vertices.length - 1];
      if (path.edges.length > 0 &&
          ((!options.targetId || current.id === options.targetId) &&
           (!options.targetType || current.type === options.targetType))) {
        matches.push(path);
      }
      if (path.edges.length >= maxDepth) continue;
      for (const edge of this.outgoing(current.id)) {
        if (path.vertices.some((vertex) => vertex.id === edge.target)) continue;
        const target = this.getVertex(edge.target);
        if (target) queue.push({ vertices: [...path.vertices, target], edges: [...path.edges, edge] });
      }
    }
    this.cache.set(key, matches);
    return matches;
  }

  /** Executes a count or numeric aggregate over indexed graph vertices. */
  aggregate(query: GraphAggregateQuery): number {
    if (query.operation !== 'count' && !query.property) {
      throw new Error(`Property is required for ${query.operation}`);
    }
    const vertices = this.vertices(query.vertexType);
    if (query.operation === 'count') return vertices.length;
    const values = vertices
      .map((vertex) => vertex.properties?.[query.property as string])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length === 0) return 0;
    if (query.operation === 'average') return values.reduce((sum, value) => sum + value, 0) / values.length;
    if (query.operation === 'minimum') return Math.min(...values);
    return Math.max(...values);
  }

  private vertices(type?: GraphVertexType): GraphVertex[] {
    const result = type
      ? this.database.exec('SELECT id, type, name, status, timestamp, properties FROM vertices WHERE type = ?', [type])
      : this.database.exec('SELECT id, type, name, status, timestamp, properties FROM vertices');
    return (result[0]?.values ?? []).map((row) => this.mapVertex(row));
  }

  private outgoing(source: string): GraphEdge[] {
    const result = this.database.exec(
      'SELECT source, target, relation, properties FROM edges WHERE source = ?',
      [source]
    );
    return (result[0]?.values ?? []).map((row) => ({
      source: row[0] as string,
      target: row[1] as string,
      relation: row[2] as string,
      properties: asProperties(row[3])
    }));
  }

  private mapVertex(row: (string | number | Uint8Array | null)[]): GraphVertex {
    const vertex: GraphVertex = {
      id: row[0] as string,
      type: row[1] as GraphVertexType,
      name: row[2] as string,
      properties: asProperties(row[5])
    };
    if (typeof row[3] === 'string') vertex.status = row[3];
    if (typeof row[4] === 'string') vertex.timestamp = row[4];
    return vertex;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Framework-independent handler for POST /api/graph/query. */
export class KnowledgeGraphQueryApi {
  /** Creates the graph query REST adapter. */
  constructor(private readonly engine: KnowledgeGraphQueryEngine) {}

  /** Handles a graph query request and returns an HTTP-compatible response. */
  handle(request: GraphQueryRequest): GraphQueryResponse {
    if (request.method.toUpperCase() !== 'POST' || request.path !== '/api/graph/query') {
      return { status: 404, body: { error: 'Route not found' } };
    }
    if (!isRecord(request.body) || typeof request.body['query'] !== 'string') {
      return { status: 400, body: { error: 'Body must include a query string' } };
    }
    try {
      const variables = isRecord(request.body['variables']) ? request.body['variables'] : {};
      const query = request.body['query'];
      if (query === 'testsForRequirement') {
        return { status: 200, body: { data: this.engine.answer({
          kind: 'tests-for-requirement',
          requirementId: this.requiredString(variables, 'requirementId')
        }) } };
      }
      if (query === 'codeForTest') {
        return { status: 200, body: { data: this.engine.answer({
          kind: 'code-for-test',
          testId: this.requiredString(variables, 'testId')
        }) } };
      }
      if (query === 'incidentsForService') {
        return { status: 200, body: { data: this.engine.answer({
          kind: 'incidents-for-service',
          serviceId: this.requiredString(variables, 'serviceId')
        }) } };
      }
      if (query === 'path') {
        return { status: 200, body: { data: this.engine.findPaths(
          this.requiredString(variables, 'startId'),
          {
            targetId: typeof variables['targetId'] === 'string' ? variables['targetId'] : undefined,
            targetType: typeof variables['targetType'] === 'string'
              ? variables['targetType'] as GraphVertexType
              : undefined,
            maxDepth: typeof variables['maxDepth'] === 'number' ? variables['maxDepth'] : undefined
          }
        ) } };
      }
      if (query === 'aggregate') {
        return { status: 200, body: { data: this.engine.aggregate({
          operation: this.requiredString(variables, 'operation') as GraphAggregateQuery['operation'],
          vertexType: typeof variables['vertexType'] === 'string'
            ? variables['vertexType'] as GraphVertexType
            : undefined,
          property: typeof variables['property'] === 'string' ? variables['property'] : undefined
        }) } };
      }
      return { status: 400, body: { error: `Unsupported query: ${query}` } };
    } catch (error) {
      return { status: 400, body: { error: error instanceof Error ? error.message : 'Invalid graph query' } };
    }
  }

  private requiredString(values: Record<string, unknown>, name: string): string {
    const value = values[name];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
    return value;
  }
}
