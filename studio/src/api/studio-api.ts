export interface StudioWorkspace {
  id: string;
  name: string;
  testFileCount: number;
}

export interface StudioApi {
  selectWorkspace(path: string): Promise<StudioWorkspace>;
}

interface ErrorEnvelope {
  error?: { message?: string };
}

/** Same-origin HTTP client for the loopback Studio service. */
export class HttpStudioApi implements StudioApi {
  constructor(private readonly baseUrl = '/api/studio/v1') {}

  async selectWorkspace(path: string): Promise<StudioWorkspace> {
    const response = await fetch(`${this.baseUrl}/workspaces/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path })
    });
    if (!response.ok) {
      const envelope = await response.json().catch(() => ({})) as ErrorEnvelope;
      throw new Error(envelope.error?.message ?? `Workspace selection failed (${response.status}).`);
    }
    return response.json() as Promise<StudioWorkspace>;
  }
}

