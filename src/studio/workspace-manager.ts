import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { StudioWorkspace } from './studio-api-contract.js';

interface WorkspaceRecord {
  summary: StudioWorkspace;
  rootPath: string;
}

/** Owns the server-side mapping between opaque workspace ids and real paths. */
export class StudioWorkspaceManager {
  private readonly records = new Map<string, WorkspaceRecord>();
  private readonly idsByPath = new Map<string, string>();

  /** Validates and selects one non-root local directory. */
  async selectWorkspace(requestedPath: string): Promise<StudioWorkspace> {
    if (!requestedPath.trim() || requestedPath.includes('\0')) {
      throw new Error('Workspace path is required.');
    }

    let canonicalPath: string;
    try {
      canonicalPath = await realpath(path.resolve(requestedPath));
    } catch {
      throw new Error('Workspace directory does not exist.');
    }

    const metadata = await stat(canonicalPath);
    if (!metadata.isDirectory()) throw new Error('Workspace path must be a directory.');
    if (canonicalPath === path.parse(canonicalPath).root) {
      throw new Error('A filesystem root cannot be selected as a Studio workspace.');
    }

    const existingId = this.idsByPath.get(this.pathKey(canonicalPath));
    if (existingId) return this.requireRecord(existingId).summary;

    const id = this.createWorkspaceId(canonicalPath);
    const summary: StudioWorkspace = {
      id,
      name: path.basename(canonicalPath),
      testFileCount: 0
    };
    this.records.set(id, { summary, rootPath: canonicalPath });
    this.idsByPath.set(this.pathKey(canonicalPath), id);
    return summary;
  }

  /** Returns browser-safe metadata without exposing the absolute root. */
  getWorkspace(id: string): StudioWorkspace {
    return this.requireRecord(id).summary;
  }

  /** Returns the canonical root for trusted server-side operations only. */
  getWorkspaceRoot(id: string): string {
    return this.requireRecord(id).rootPath;
  }

  private requireRecord(id: string): WorkspaceRecord {
    const record = this.records.get(id);
    if (!record) throw new Error('Studio workspace was not found.');
    return record;
  }

  private createWorkspaceId(canonicalPath: string): string {
    return `ws_${createHash('sha256').update(canonicalPath).digest('base64url').slice(0, 24)}`;
  }

  private pathKey(canonicalPath: string): string {
    return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
  }
}

