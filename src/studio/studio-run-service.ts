import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { StudioEvidence, StudioEvidenceKind, StudioRunEvent, StudioRunRequest, StudioRunSummary } from './studio-api-contract.js';
import { isStudioRunRequest } from './studio-api-contract.js';
import { validateStudioDocument } from './studio-document-validator.js';
import type { StudioWorkspaceManager } from './workspace-manager.js';

export interface StudioSpawnRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

export interface StudioSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type StudioCommandRunner = (request: StudioSpawnRequest) => Promise<StudioSpawnResult>;

interface QueuedRun {
  id: string;
  request: StudioRunRequest;
  cwd: string;
  url: string;
}

export interface StudioEvidenceRecord {
  metadata: StudioEvidence;
  content: Buffer;
}

/** Runs only the fixed PROVA `run` command assembled from validated Studio values. */
export class StudioRunService {
  private readonly runs = new Map<string, StudioRunSummary>();
  private readonly events = new Map<string, StudioRunEvent[]>();
  private readonly subscribers = new Map<string, Set<(event: StudioRunEvent) => void>>();
  private readonly queue: QueuedRun[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private readonly evidence = new Map<string, StudioEvidenceRecord[]>();
  private activeCount = 0;

  constructor(
    private readonly workspaces: StudioWorkspaceManager,
    private readonly cliEntry = path.resolve('dist/cli/run.js'),
    private readonly runner: StudioCommandRunner = spawnProva,
    private readonly maxConcurrency = 2
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 8) {
      throw new Error('Studio concurrency must be an integer from 1 to 8.');
    }
  }

  async startRun(value: unknown): Promise<StudioRunSummary> {
    if (!isStudioRunRequest(value)) throw new Error('Invalid Studio run request.');
    const request: StudioRunRequest = value;
    const target = await this.workspaces.getRunTarget(request.workspaceId, request.fileId);
    const validated = validateStudioDocument(target.document.content, target.document.format);
    if (!validated.definition || validated.diagnostics.length > 0) {
      throw new Error('The selected test definition is invalid.');
    }

    const id = `run_${randomUUID().replaceAll('-', '')}`;
    const queued: StudioRunSummary = {
      id,
      workspaceId: request.workspaceId,
      fileId: request.fileId,
      status: 'queued'
    };
    this.runs.set(id, queued);
    this.events.set(id, []);
    this.evidence.set(id, []);
    this.emit(id, { type: 'status', sequence: 0, timestamp: new Date().toISOString(), status: 'queued' });
    this.queue.push({ id, request, cwd: target.rootPath, url: validated.definition.url });
    this.pump();
    return this.getRun(id);
  }

  getRun(id: string): StudioRunSummary {
    const run = this.runs.get(id);
    if (!run) throw new Error('Studio run was not found.');
    return run;
  }

  listRuns(limit = 50): readonly StudioRunSummary[] {
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
    return [...this.runs.values()].reverse().slice(0, bounded);
  }

  listEvidence(runId: string): readonly StudioEvidence[] {
    this.getRun(runId);
    return (this.evidence.get(runId) ?? []).map(record => record.metadata);
  }

  getEvidence(runId: string, evidenceId: string): StudioEvidenceRecord {
    this.getRun(runId);
    const record = (this.evidence.get(runId) ?? []).find(item => item.metadata.id === evidenceId);
    if (!record) throw new Error('Studio evidence was not found.');
    return record;
  }

  getEvents(id: string, afterSequence = -1): readonly StudioRunEvent[] {
    this.getRun(id);
    return (this.events.get(id) ?? []).filter(event => event.sequence > afterSequence);
  }

  subscribe(id: string, listener: (event: StudioRunEvent) => void): () => void {
    this.getRun(id);
    const listeners = this.subscribers.get(id) ?? new Set();
    listeners.add(listener);
    this.subscribers.set(id, listeners);
    return () => listeners.delete(listener);
  }

  cancelRun(id: string): StudioRunSummary {
    const current = this.getRun(id);
    if (isTerminal(current.status)) return current;
    const queuedIndex = this.queue.findIndex(item => item.id === id);
    if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
    this.controllers.get(id)?.abort();
    this.complete(id, 'cancelled', undefined, 'Run cancelled by user.');
    return this.getRun(id);
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (this.getRun(next.id).status !== 'queued') continue;
      this.activeCount += 1;
      const started = Date.now();
      this.runs.set(next.id, {
        ...this.getRun(next.id),
        status: 'running',
        startedAt: new Date(started).toISOString()
      });
      this.emit(next.id, {
        type: 'status', sequence: 0, timestamp: new Date(started).toISOString(), status: 'running'
      });
      void this.execute(next).finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
    }
  }

  private async execute(
    queued: QueuedRun
  ): Promise<void> {
    const { id, request, cwd, url } = queued;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    let timer: NodeJS.Timeout | undefined;
    try {
      const execution = this.runner({
        executable: process.execPath,
        args: [
          this.cliEntry,
          'run',
          '--url', url,
          '--type', 'browser',
          '--browser', request.browser,
          '--timeout', String(request.timeoutMs)
        ],
        cwd,
        timeoutMs: request.timeoutMs,
        signal: controller.signal,
        onStdout: text => this.emitOutput(id, 'stdout', text),
        onStderr: text => this.emitOutput(id, 'stderr', text)
      });
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new StudioTimeoutError());
        }, request.timeoutMs);
        timer.unref();
      });
      const result = await Promise.race([execution, timeout]);
      if (isTerminal(this.getRun(id).status)) return;
      await this.captureEvidence(id, cwd, result);
      this.complete(id, result.exitCode === 0 ? 'passed' : 'failed', result.exitCode,
        result.exitCode === 0 ? undefined : safeFailure(result.stderr));
    } catch (error) {
      if (isTerminal(this.getRun(id).status)) return;
      if (error instanceof StudioTimeoutError) {
        this.complete(id, 'timed-out', undefined, `Run exceeded ${request.timeoutMs}ms timeout.`);
      } else {
        this.complete(id, 'failed', undefined,
          safeFailure(error instanceof Error ? error.message : 'CLI execution failed.'));
      }
    } finally {
      if (timer) clearTimeout(timer);
      this.controllers.delete(id);
    }
  }

  private complete(
    id: string,
    status: 'passed' | 'failed' | 'cancelled' | 'timed-out',
    exitCode?: number,
    failureSummary?: string
  ): void {
    const current = this.getRun(id);
    const finished = Date.now();
    const started = current.startedAt ? Date.parse(current.startedAt) : finished;
    this.runs.set(id, {
      ...current,
      status,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      exitCode,
      failureSummary
    });
    this.emit(id, {
      type: 'complete',
      sequence: 0,
      timestamp: new Date(finished).toISOString(),
      summary: this.getRun(id)
    });
  }

  private emitOutput(id: string, type: 'stdout' | 'stderr', text: string): void {
    if (!text) return;
    this.emit(id, { type, sequence: 0, timestamp: new Date().toISOString(), text });
  }

  private async captureEvidence(id: string, cwd: string, result: StudioSpawnResult): Promise<void> {
    const log = Buffer.from(`${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`, 'utf8');
    this.addEvidence(id, 'log', 'command-output.log', 'text/plain; charset=utf-8', log);
    const fields: { key: string; kind: StudioEvidenceKind; mediaType: string }[] = [
      { key: 'screenshotPath', kind: 'screenshot', mediaType: 'image/png' },
      { key: 'tracePath', kind: 'trace', mediaType: 'application/zip' },
      { key: 'reportPath', kind: 'report', mediaType: 'text/html; charset=utf-8' }
    ];
    for (const line of result.stdout.split(/\r?\n/)) {
      let value: unknown;
      try { value = JSON.parse(line); } catch { continue; }
      if (!isRecord(value)) continue;
      for (const field of fields) {
        const candidate = value[field.key];
        if (typeof candidate !== 'string') continue;
        const content = await readContainedEvidence(cwd, candidate).catch(() => undefined);
        if (content) this.addEvidence(id, field.kind, path.basename(candidate), field.mediaType, content);
      }
    }
  }

  private addEvidence(
    runId: string,
    kind: StudioEvidenceKind,
    name: string,
    mediaType: string,
    content: Buffer
  ): void {
    const metadata: StudioEvidence = {
      id: `evidence_${randomUUID().replaceAll('-', '')}`,
      runId,
      kind,
      name,
      mediaType,
      size: content.byteLength
    };
    const records = this.evidence.get(runId) ?? [];
    records.push({ metadata, content });
    this.evidence.set(runId, records);
    this.emit(runId, { type: 'evidence', sequence: 0, timestamp: new Date().toISOString(), evidence: metadata });
  }

  private emit(id: string, event: StudioRunEvent): void {
    const history = this.events.get(id) ?? [];
    const sequenced = { ...event, sequence: history.length } as StudioRunEvent;
    history.push(sequenced);
    this.events.set(id, history);
    for (const listener of this.subscribers.get(id) ?? []) listener(sequenced);
  }
}

function spawnProva(request: StudioSpawnRequest): Promise<StudioSpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0' }
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const abort = (): void => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2_000).unref();
    };
    request.signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      const buffer = Buffer.from(chunk);
      stdout.push(buffer);
      request.onStdout?.(buffer.toString('utf8'));
    });
    child.stderr.on('data', chunk => {
      const buffer = Buffer.from(chunk);
      stderr.push(buffer);
      request.onStderr?.(buffer.toString('utf8'));
    });
    child.once('error', reject);
    child.once('close', code => {
      request.signal.removeEventListener('abort', abort);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });
}

class StudioTimeoutError extends Error {}

function isTerminal(status: StudioRunSummary['status']): boolean {
  return ['passed', 'failed', 'cancelled', 'timed-out'].includes(status);
}

function safeFailure(value: string): string {
  return value.replaceAll(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim().slice(0, 2_000) || 'CLI run failed.';
}

async function readContainedEvidence(cwd: string, candidate: string): Promise<Buffer> {
  const root = await realpath(cwd);
  const absolute = await realpath(path.resolve(root, candidate));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Evidence path escaped the workspace.');
  }
  const metadata = await stat(absolute);
  if (!metadata.isFile() || metadata.size > 25 * 1024 * 1024) {
    throw new Error('Evidence file is invalid or too large.');
  }
  return readFile(absolute);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
