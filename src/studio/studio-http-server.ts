import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { STUDIO_API_PREFIX } from './studio-api-contract.js';
import type { StudioRunService } from './studio-run-service.js';
import { StudioDocumentValidationError, type StudioWorkspaceManager } from './workspace-manager.js';

const MAX_REQUEST_BYTES = 32 * 1024;

/** Creates the Studio API server. Call `listenStudioLoopback` to ensure local-only binding. */
export function createStudioHttpServer(
  runs: StudioRunService,
  workspaces?: StudioWorkspaceManager
): Server {
  return createServer((request, response) => {
    void route(request, response, runs, workspaces).catch(error => {
      sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: safeMessage(error) } });
    });
  });
}

/** Binds only to IPv4 loopback; callers cannot override the host. */
export async function listenStudioLoopback(
  server: Server,
  port = 0
): Promise<{ host: '127.0.0.1'; port: number }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return { host: '127.0.0.1', port: address.port };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  runs: StudioRunService,
  workspaces?: StudioWorkspaceManager
): Promise<void> {
  if (!isLocalRequest(request)) {
    sendJson(response, 403, { error: { code: 'FORBIDDEN', message: 'Studio API is loopback-only.' } });
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname === `${STUDIO_API_PREFIX}/workspaces/select`) {
    if (!workspaces) return sendUnavailable(response);
    try {
      const body = await requireJson(request);
      if (!isRecord(body) || typeof body['path'] !== 'string') throw new Error('Workspace path is required.');
      sendJson(response, 200, await workspaces.selectWorkspace(body['path']));
    } catch (error) {
      sendJson(response, 400, { error: { code: 'BAD_REQUEST', message: safeMessage(error) } });
    }
    return;
  }
  const filesMatch = new RegExp(`^${STUDIO_API_PREFIX}/workspaces/([A-Za-z0-9_-]{8,128})/files$`).exec(url.pathname);
  if (request.method === 'GET' && filesMatch) {
    if (!workspaces) return sendUnavailable(response);
    try {
      sendJson(response, 200, await workspaces.listTestFiles(filesMatch[1]!));
    } catch (error) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: safeMessage(error) } });
    }
    return;
  }
  const documentMatch = new RegExp(
    `^${STUDIO_API_PREFIX}/workspaces/([A-Za-z0-9_-]{8,128})/files/([A-Za-z0-9_-]{8,128})$`
  ).exec(url.pathname);
  if (request.method === 'GET' && documentMatch) {
    if (!workspaces) return sendUnavailable(response);
    try {
      sendJson(response, 200, await workspaces.readTestDocument(documentMatch[1]!, documentMatch[2]!));
    } catch (error) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: safeMessage(error) } });
    }
    return;
  }
  if (request.method === 'PUT' && documentMatch) {
    if (!workspaces) return sendUnavailable(response);
    try {
      const body = await requireJson(request);
      if (!isRecord(body) || typeof body['content'] !== 'string' || typeof body['expectedRevision'] !== 'string') {
        throw new Error('content and expectedRevision are required.');
      }
      sendJson(response, 200, await workspaces.saveTestDocument(
        documentMatch[1]!, documentMatch[2]!, body['content'], body['expectedRevision']
      ));
    } catch (error) {
      if (error instanceof StudioDocumentValidationError) {
        sendJson(response, 422, {
          error: { code: 'VALIDATION_FAILED', message: error.message, details: error.diagnostics }
        });
      } else {
        sendJson(response, safeMessage(error).includes('changed on disk') ? 409 : 400, {
          error: { code: 'BAD_REQUEST', message: safeMessage(error) }
        });
      }
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === `${STUDIO_API_PREFIX}/runs`) {
    const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
    sendJson(response, 200, runs.listRuns(Number.isFinite(requestedLimit) ? requestedLimit : 50));
    return;
  }
  if (request.method === 'POST' && url.pathname === `${STUDIO_API_PREFIX}/runs`) {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      sendJson(response, 415, { error: { code: 'BAD_REQUEST', message: 'application/json is required.' } });
      return;
    }
    try {
      const summary = await runs.startRun(await readJson(request));
      sendJson(response, 202, summary);
    } catch (error) {
      sendJson(response, 400, { error: { code: 'BAD_REQUEST', message: safeMessage(error) } });
    }
    return;
  }
  const match = new RegExp(`^${STUDIO_API_PREFIX}/runs/(run_[A-Za-z0-9_-]{16,128})$`).exec(url.pathname);
  if (request.method === 'GET' && match) {
    try {
      sendJson(response, 200, runs.getRun(match[1]!));
    } catch (error) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: safeMessage(error) } });
    }
    return;
  }
  if (request.method === 'DELETE' && match) {
    try {
      sendJson(response, 200, runs.cancelRun(match[1]!));
    } catch (error) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: safeMessage(error) } });
    }
    return;
  }
  const eventMatch = new RegExp(`^${STUDIO_API_PREFIX}/runs/(run_[A-Za-z0-9_-]{16,128})/events$`).exec(url.pathname);
  if (request.method === 'GET' && eventMatch) {
    try {
      const runId = eventMatch[1]!;
      const after = Number(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? -1);
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      const send = (event: import('./studio-api-contract.js').StudioRunEvent): void => {
        response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'complete') response.end();
      };
      const history = runs.getEvents(runId, Number.isFinite(after) ? after : -1);
      history.forEach(send);
      if (!history.some(event => event.type === 'complete')) {
        const unsubscribe = runs.subscribe(runId, send);
        request.once('close', unsubscribe);
      }
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 404, { error: { code: 'NOT_FOUND', message: safeMessage(error) } });
      } else {
        response.end();
      }
    }
    return;
  }
  const evidenceListMatch = new RegExp(`^${STUDIO_API_PREFIX}/runs/(run_[A-Za-z0-9_-]{16,128})/evidence$`).exec(url.pathname);
  if (request.method === 'GET' && evidenceListMatch) {
    try {
      sendJson(response, 200, runs.listEvidence(evidenceListMatch[1]!));
    } catch (error) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: safeMessage(error) } });
    }
    return;
  }
  const evidenceMatch = new RegExp(
    `^${STUDIO_API_PREFIX}/runs/(run_[A-Za-z0-9_-]{16,128})/evidence/(evidence_[A-Za-z0-9_-]{16,128})$`
  ).exec(url.pathname);
  if (request.method === 'GET' && evidenceMatch) {
    try {
      const record = runs.getEvidence(evidenceMatch[1]!, evidenceMatch[2]!);
      response.writeHead(200, {
        'content-type': record.metadata.mediaType,
        'content-length': record.content.byteLength,
        'content-disposition': `inline; filename="${safeFileName(record.metadata.name)}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      response.end(record.content);
    } catch (error) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: safeMessage(error) } });
    }
    return;
  }
  sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Studio route was not found.' } });
}

function isLocalRequest(request: IncomingMessage): boolean {
  const remote = request.socket.remoteAddress;
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error('Studio request body is too large.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('Request body must contain valid JSON.');
  }
}

async function requireJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new Error('application/json is required.');
  }
  return readJson(request);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(value));
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Studio request failed.';
}

function safeFileName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'evidence';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendUnavailable(response: ServerResponse): void {
  sendJson(response, 503, { error: { code: 'INTERNAL_ERROR', message: 'Workspace service is unavailable.' } });
}
