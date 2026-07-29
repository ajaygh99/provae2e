import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  StudioTestFile,
  StudioTestFormat,
  StudioWorkspace
} from './studio-api-contract.js';

interface WorkspaceRecord {
  summary: StudioWorkspace;
  rootPath: string;
  files: Map<string, string>;
}

const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'coverage', 'artifacts'
]);
const MAX_DISCOVERED_FILES = 500;

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
    this.records.set(id, { summary, rootPath: canonicalPath, files: new Map() });
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

  /** Discovers supported YAML/JSON test definitions without following symlinks. */
  async listTestFiles(id: string): Promise<StudioTestFile[]> {
    const record = this.requireRecord(id);
    const discovered: StudioTestFile[] = [];
    record.files.clear();

    const visit = async (directory: string): Promise<void> => {
      if (discovered.length >= MAX_DISCOVERED_FILES) return;
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (discovered.length >= MAX_DISCOVERED_FILES) break;
        if (entry.isSymbolicLink()) continue;
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolutePath);
          continue;
        }
        if (!entry.isFile()) continue;
        const format = supportedTestFormat(entry.name);
        if (!format) continue;
        const relativePath = path.relative(record.rootPath, absolutePath).split(path.sep).join('/');
        const fileId = this.createFileId(id, relativePath);
        const metadata = await stat(absolutePath);
        record.files.set(fileId, absolutePath);
        discovered.push({
          id: fileId,
          workspaceId: id,
          name: entry.name,
          relativePath,
          format,
          updatedAt: metadata.mtime.toISOString()
        });
      }
    };

    await visit(record.rootPath);
    record.summary.testFileCount = discovered.length;
    return discovered;
  }

  private requireRecord(id: string): WorkspaceRecord {
    const record = this.records.get(id);
    if (!record) throw new Error('Studio workspace was not found.');
    return record;
  }

  private createWorkspaceId(canonicalPath: string): string {
    return `ws_${createHash('sha256').update(canonicalPath).digest('base64url').slice(0, 24)}`;
  }

  private createFileId(workspaceId: string, relativePath: string): string {
    return `file_${createHash('sha256').update(`${workspaceId}\0${relativePath}`).digest('base64url').slice(0, 24)}`;
  }

  private pathKey(canonicalPath: string): string {
    return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
  }
}

function supportedTestFormat(fileName: string): StudioTestFormat | undefined {
  const normalized = fileName.toLowerCase();
  const supported = /\.(?:prova|provae2e|test|spec)\.(ya?ml|json)$/.exec(normalized);
  if (!supported) return undefined;
  return supported[1] === 'json' ? 'json' : 'yaml';
}
