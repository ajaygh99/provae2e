import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { STUDIO_API_PREFIX } from './studio-api-contract.js';
import type { StudioRunService } from './studio-run-service.js';

const MAX_REQUEST_BYTES = 32 * 1024;

/** Creates the Studio API server. Call `listenStudioLoopback` to ensure local-only binding. */
export function createStudioHttpServer(runs: StudioRunService): Server {
  return createServer((request, response) => {
    void route(request, response, runs).catch(error => {
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
  runs: StudioRunService
): Promise<void> {
  if (!isLocalRequest(request)) {
    sendJson(response, 403, { error: { code: 'FORBIDDEN', message: 'Studio API is loopback-only.' } });
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
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
