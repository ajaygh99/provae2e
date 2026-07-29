import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  StudioTestFile,
  StudioTestDocument,
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
const MAX_TEST_FILE_BYTES = 1024 * 1024;

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

  /** Reads a previously discovered test definition after rechecking containment. */
  async readTestDocument(workspaceId: string, fileId: string): Promise<StudioTestDocument> {
    const record = this.requireRecord(workspaceId);
    const filePath = await this.requireSafeFile(record, fileId);
    const metadata = await stat(filePath);
    if (metadata.size > MAX_TEST_FILE_BYTES) {
      throw new Error('Studio test files cannot exceed 1 MB.');
    }
    const content = await readFile(filePath, 'utf8');
    const file = this.toTestFile(record, workspaceId, fileId, filePath, metadata.mtime);
    return {
      ...file,
      content,
      revision: revisionFor(content),
      diagnostics: []
    };
  }

  /** Saves through an atomic same-directory rename with optimistic revision control. */
  async saveTestDocument(
    workspaceId: string,
    fileId: string,
    content: string,
    expectedRevision: string
  ): Promise<StudioTestDocument> {
    if (Buffer.byteLength(content, 'utf8') > MAX_TEST_FILE_BYTES) {
      throw new Error('Studio test files cannot exceed 1 MB.');
    }
    const current = await this.readTestDocument(workspaceId, fileId);
    if (current.revision !== expectedRevision) {
      throw new Error('The test file changed on disk. Reload it before saving.');
    }

    const record = this.requireRecord(workspaceId);
    const filePath = await this.requireSafeFile(record, fileId);
    const temporaryPath = `${filePath}.${randomUUID()}.studio-tmp`;
    try {
      await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return this.readTestDocument(workspaceId, fileId);
  }

  private requireRecord(id: string): WorkspaceRecord {
    const record = this.records.get(id);
    if (!record) throw new Error('Studio workspace was not found.');
    return record;
  }

  private async requireSafeFile(record: WorkspaceRecord, fileId: string): Promise<string> {
    const registeredPath = record.files.get(fileId);
    if (!registeredPath) throw new Error('Studio test file was not found.');
    const metadata = await lstat(registeredPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error('Studio test file is not a regular file.');
    }
    const canonicalPath = await realpath(registeredPath);
    const relative = path.relative(record.rootPath, canonicalPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Studio test file escaped the selected workspace.');
    }
    return canonicalPath;
  }

  private toTestFile(
    record: WorkspaceRecord,
    workspaceId: string,
    fileId: string,
    filePath: string,
    modifiedAt: Date
  ): StudioTestFile {
    const format = supportedTestFormat(path.basename(filePath));
    if (!format) throw new Error('Studio test file format is not supported.');
    return {
      id: fileId,
      workspaceId,
      name: path.basename(filePath),
      relativePath: path.relative(record.rootPath, filePath).split(path.sep).join('/'),
      format,
      updatedAt: modifiedAt.toISOString()
    };
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

function revisionFor(content: string): string {
  return createHash('sha256').update(content).digest('base64url');
}
