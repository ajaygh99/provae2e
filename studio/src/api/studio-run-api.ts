export type StudioRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'timed-out';

export interface StudioRunSummary {
  id: string;
  workspaceId: string;
  fileId: string;
  status: StudioRunStatus;
  durationMs?: number;
  failureSummary?: string;
}

export type StudioRunEvent =
  | { type: 'status'; sequence: number; status: StudioRunStatus }
  | { type: 'stdout' | 'stderr'; sequence: number; text: string }
  | { type: 'complete'; sequence: number; summary: StudioRunSummary };

export interface StudioEvidence {
  id: string;
  runId: string;
  kind: 'screenshot' | 'trace' | 'log' | 'report';
  name: string;
  mediaType: string;
  size: number;
}

export interface StudioRunApi {
  startRun: (workspaceId: string, fileId: string, browser: string, timeoutMs: number) => Promise<StudioRunSummary>;
  streamEvents: (
    runId: string,
    onEvent: (event: StudioRunEvent) => void,
    onError: () => void
  ) => () => void;
  cancelRun: (runId: string) => Promise<StudioRunSummary>;
  listRuns: () => Promise<readonly StudioRunSummary[]>;
  listEvidence: (runId: string) => Promise<readonly StudioEvidence[]>;
  evidenceUrl: (runId: string, evidenceId: string) => string;
}

export class HttpStudioRunApi implements StudioRunApi {
  constructor(private readonly baseUrl = '/api/studio/v1') {}

  async startRun(workspaceId: string, fileId: string, browser: string, timeoutMs: number): Promise<StudioRunSummary> {
    const response = await fetch(`${this.baseUrl}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId, fileId, browser, timeoutMs })
    });
    if (!response.ok) throw new Error(`Run could not start (${response.status}).`);
    return response.json() as Promise<StudioRunSummary>;
  }

  streamEvents(runId: string, onEvent: (event: StudioRunEvent) => void, onError: () => void): () => void {
    const source = new EventSource(`${this.baseUrl}/runs/${encodeURIComponent(runId)}/events`);
    for (const type of ['status', 'stdout', 'stderr', 'complete']) {
      source.addEventListener(type, message => {
        onEvent(JSON.parse((message as MessageEvent<string>).data) as StudioRunEvent);
        if (type === 'complete') source.close();
      });
    }
    source.onerror = onError;
    return () => source.close();
  }

  async cancelRun(runId: string): Promise<StudioRunSummary> {
    const response = await fetch(`${this.baseUrl}/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Run could not be cancelled (${response.status}).`);
    return response.json() as Promise<StudioRunSummary>;
  }

  async listRuns(): Promise<readonly StudioRunSummary[]> {
    const response = await fetch(`${this.baseUrl}/runs?limit=50`);
    if (!response.ok) throw new Error(`Run history could not be loaded (${response.status}).`);
    return response.json() as Promise<readonly StudioRunSummary[]>;
  }

  async listEvidence(runId: string): Promise<readonly StudioEvidence[]> {
    const response = await fetch(`${this.baseUrl}/runs/${encodeURIComponent(runId)}/evidence`);
    if (!response.ok) throw new Error(`Run evidence could not be loaded (${response.status}).`);
    return response.json() as Promise<readonly StudioEvidence[]>;
  }

  evidenceUrl(runId: string, evidenceId: string): string {
    return `${this.baseUrl}/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(evidenceId)}`;
  }
}
