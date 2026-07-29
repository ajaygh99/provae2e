/** Figma REST connector for browser-test generation context. */
import axios from 'axios';
import { parseFigmaReference } from './figma-reference.js';

/** A meaningful named element extracted from a Figma node tree. */
export interface FigmaElement {
  name: string;
  type: string;
  text?: string;
}

/** Options accepted by {@link fetchFigmaElements}. */
export interface FigmaConnectorOptions {
  /** Figma file key copied from the design URL. */
  fileKey: string;
  /** Frame/node ID copied from the design URL or Figma UI. */
  nodeId: string;
  /** Personal access token read by the CLI from `FIGMA_API_TOKEN`. */
  apiToken?: string;
  /** OAuth2 access token; preferred over a personal token when supplied. */
  accessToken?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Retries for 429 and 5xx responses. Defaults to 2; maximum 5. */
  maxRetries?: number;
  /** Base retry delay in milliseconds. Defaults to 500. */
  retryDelayMs?: number;
  /** Optional caller cancellation signal. */
  signal?: AbortSignal;
}

/** Successful or failed Figma element ingestion. */
export type FigmaElementsResult =
  | { ok: true; fileKey: string; nodeId: string; elements: FigmaElement[] }
  | { ok: false; error: string };

interface FigmaNode {
  type?: unknown;
  name?: unknown;
  characters?: unknown;
  children?: unknown;
}

interface FigmaNodesResponse {
  nodes?: Record<string, { document?: unknown } | null>;
}

const MEANINGFUL_NAME = /(button|input|field|link|checkbox|dropdown)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNode(value: unknown): FigmaNode | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * Walks a Figma node tree and extracts text nodes plus nodes whose names imply
 * an interactive UI role.
 *
 * @param root - Root Figma document/frame node.
 * @returns Flat meaningful-element list in document order.
 */
export function extractFigmaElements(root: unknown): FigmaElement[] {
  const elements: FigmaElement[] = [];
  const walk = (value: unknown): void => {
    const node = toNode(value);
    if (!node) return;
    const type = typeof node.type === 'string' ? node.type : '';
    const name = typeof node.name === 'string' ? node.name.trim() : '';
    const text = typeof node.characters === 'string' ? node.characters.trim() : '';
    if (name && (type.toUpperCase() === 'TEXT' || MEANINGFUL_NAME.test(name))) {
      elements.push({ name, type: type || 'UNKNOWN', ...(text ? { text } : {}) });
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  walk(root);
  return elements;
}

function redactToken(message: string, token: string): string {
  return message.split(token).join('[REDACTED]');
}

/**
 * Fetches a Figma frame through REST API v1 and extracts test-relevant nodes.
 * The token is confined to `X-Figma-Token` and redacted from returned errors.
 *
 * @param options - File key, frame ID, personal access token, and timeout.
 * @returns Extracted elements or a safe, actionable failure.
 */
export async function fetchFigmaElements(options: FigmaConnectorOptions): Promise<FigmaElementsResult> {
  const reference = parseFigmaReference(options.fileKey, options.nodeId);
  if (!reference.ok) return reference;
  const { fileKey, nodeId } = reference.reference;
  const token = options.accessToken?.trim() || options.apiToken?.trim();
  if (!token) {
    return { ok: false, error: 'A Figma OAuth access token or FIGMA_API_TOKEN is required' };
  }
  const timeoutMs = options.timeoutMs ?? 30000;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 500;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    return { ok: false, error: 'Figma timeoutMs must be an integer from 1000 to 120000.' };
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    return { ok: false, error: 'Figma maxRetries must be an integer from 0 to 5.' };
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10000) {
    return { ok: false, error: 'Figma retryDelayMs must be an integer from 0 to 10000.' };
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await axios.get<FigmaNodesResponse>(
        `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes`,
        {
          headers: options.accessToken
            ? { Authorization: `Bearer ${options.accessToken}` }
            : { 'X-Figma-Token': options.apiToken },
          params: { ids: nodeId },
          timeout: timeoutMs,
          ...(options.signal ? { signal: options.signal } : {})
        }
      );
    const nodes = response.data.nodes;
    const alternateNodeId = nodeId.includes(':') ? nodeId.replace(':', '-') : nodeId.replace('-', ':');
    const soleEntry = nodes && Object.keys(nodes).length === 1 ? Object.values(nodes)[0] : undefined;
    const entry = nodes?.[nodeId] ?? nodes?.[alternateNodeId] ?? soleEntry;
    if (!entry?.document) {
      return { ok: false, error: `Figma node ${nodeId} was not found in file ${fileKey}` };
    }
    const elements = extractFigmaElements(entry.document);
    if (elements.length === 0) {
      return { ok: false, error: `Figma frame ${nodeId} contains no meaningful named elements` };
    }
      return { ok: true, fileKey, nodeId, elements };
    } catch (error) {
      if (options.signal?.aborted) {
        return { ok: false, error: `Figma request for frame ${nodeId} was cancelled.` };
      }
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          return { ok: false, error: `Figma authentication failed (${status}). Check token permissions.` };
        }
        if (status === 404) {
          return { ok: false, error: `Figma file ${fileKey} or node ${nodeId} was not found (404)` };
        }
        if (isRetryableStatus(status) && attempt < maxRetries) {
          const delayMs = retryAfterMs(error.response?.headers?.['retry-after'], retryDelayMs, attempt);
          await delay(delayMs, options.signal);
          continue;
        }
      }
      const message = redactToken(error instanceof Error ? error.message : String(error), token);
      const attempts = attempt + 1;
      return {
        ok: false,
        error: `Unable to fetch Figma frame ${nodeId} after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${message}`
      };
    }
  }
  return { ok: false, error: `Unable to fetch Figma frame ${nodeId}.` };
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

function retryAfterMs(value: unknown, baseDelayMs: number, attempt: number): number {
  const seconds = typeof value === 'string' ? Number(value) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10000);
  return Math.min(baseDelayMs * (2 ** attempt), 10000);
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds === 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const cancel = (): void => {
      clearTimeout(timer);
      reject(new Error('Figma request was cancelled.'));
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
