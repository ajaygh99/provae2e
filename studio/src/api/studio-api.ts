export interface StudioWorkspace {
  id: string;
  name: string;
  testFileCount: number;
}

export interface StudioTestFile {
  id: string;
  workspaceId: string;
  name: string;
  relativePath: string;
  format: 'yaml' | 'json';
  updatedAt: string;
}

export interface StudioDiagnostic {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

export interface StudioTestDocument extends StudioTestFile {
  content: string;
  revision: string;
  diagnostics: readonly StudioDiagnostic[];
}

export interface StudioApi {
  selectWorkspace: (path: string) => Promise<StudioWorkspace>;
  listFiles: (workspaceId: string) => Promise<StudioTestFile[]>;
  readDocument: (workspaceId: string, fileId: string) => Promise<StudioTestDocument>;
  saveDocument: (
    workspaceId: string,
    fileId: string,
    content: string,
    expectedRevision: string
  ) => Promise<StudioTestDocument>;
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

  async listFiles(workspaceId: string): Promise<StudioTestFile[]> {
    const response = await fetch(`${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/files`);
    if (!response.ok) {
      const envelope = await response.json().catch(() => ({})) as ErrorEnvelope;
      throw new Error(envelope.error?.message ?? `Test-file discovery failed (${response.status}).`);
    }
    return response.json() as Promise<StudioTestFile[]>;
  }

  async readDocument(workspaceId: string, fileId: string): Promise<StudioTestDocument> {
    const response = await fetch(
      `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(fileId)}`
    );
    return this.documentResponse(response, 'Test document could not be loaded');
  }

  async saveDocument(
    workspaceId: string,
    fileId: string,
    content: string,
    expectedRevision: string
  ): Promise<StudioTestDocument> {
    const response = await fetch(
      `${this.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(fileId)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, expectedRevision })
      }
    );
    return this.documentResponse(response, 'Test document could not be saved');
  }

  private async documentResponse(response: Response, fallback: string): Promise<StudioTestDocument> {
    if (!response.ok) {
      const envelope = await response.json().catch(() => ({})) as ErrorEnvelope;
      throw new Error(envelope.error?.message ?? `${fallback} (${response.status}).`);
    }
    return response.json() as Promise<StudioTestDocument>;
  }
}
