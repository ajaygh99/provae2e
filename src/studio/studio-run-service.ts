import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { StudioRunRequest, StudioRunSummary } from './studio-api-contract.js';
import { isStudioRunRequest } from './studio-api-contract.js';
import { validateStudioDocument } from './studio-document-validator.js';
import type { StudioWorkspaceManager } from './workspace-manager.js';

export interface StudioSpawnRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
}

export interface StudioSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type StudioCommandRunner = (request: StudioSpawnRequest) => Promise<StudioSpawnResult>;

/** Runs only the fixed PROVA `run` command assembled from validated Studio values. */
export class StudioRunService {
  private readonly runs = new Map<string, StudioRunSummary>();

  constructor(
    private readonly workspaces: StudioWorkspaceManager,
    private readonly cliEntry = path.resolve('dist/cli/run.js'),
    private readonly runner: StudioCommandRunner = spawnProva
  ) {}

  async startRun(value: unknown): Promise<StudioRunSummary> {
    if (!isStudioRunRequest(value)) throw new Error('Invalid Studio run request.');
    const request: StudioRunRequest = value;
    const target = await this.workspaces.getRunTarget(request.workspaceId, request.fileId);
    const validated = validateStudioDocument(target.document.content, target.document.format);
    if (!validated.definition || validated.diagnostics.length > 0) {
      throw new Error('The selected test definition is invalid.');
    }

    const id = `run_${randomUUID().replaceAll('-', '')}`;
    const started = Date.now();
    const running: StudioRunSummary = {
      id,
      workspaceId: request.workspaceId,
      fileId: request.fileId,
      status: 'running',
      startedAt: new Date(started).toISOString()
    };
    this.runs.set(id, running);

    void this.execute(id, request, target.rootPath, validated.definition.url, started);
    return running;
  }

  getRun(id: string): StudioRunSummary {
    const run = this.runs.get(id);
    if (!run) throw new Error('Studio run was not found.');
    return run;
  }

  private async execute(
    id: string,
    request: StudioRunRequest,
    cwd: string,
    url: string,
    started: number
  ): Promise<void> {
    try {
      const result = await this.runner({
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
        timeoutMs: request.timeoutMs
      });
      this.finish(id, started, result.exitCode === 0 ? 'passed' : 'failed', result.exitCode,
        result.exitCode === 0 ? undefined : safeFailure(result.stderr));
    } catch (error) {
      this.finish(id, started, 'failed', undefined,
        safeFailure(error instanceof Error ? error.message : 'CLI execution failed.'));
    }
  }

  private finish(
    id: string,
    started: number,
    status: 'passed' | 'failed',
    exitCode?: number,
    failureSummary?: string
  ): void {
    const current = this.getRun(id);
    const finished = Date.now();
    this.runs.set(id, {
      ...current,
      status,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      exitCode,
      failureSummary
    });
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
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', code => resolve({
      exitCode: code ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8')
    }));
  });
}

function safeFailure(value: string): string {
  return value.replaceAll(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim().slice(0, 2_000) || 'CLI run failed.';
}
