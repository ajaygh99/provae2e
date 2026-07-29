/** Canonical Figma file/node reference parsed from a key pair or copied URL. */
export interface FigmaReference {
  fileKey: string;
  nodeId: string;
}

export type FigmaReferenceResult =
  | { ok: true; reference: FigmaReference }
  | { ok: false; error: string };

const FILE_KEY = /^[A-Za-z0-9_-]+$/;
const NODE_ID = /^[A-Za-z0-9:_;-]+$/;
const FIGMA_PATH_KIND = new Set(['design', 'file', 'proto', 'board']);

/** Converts the `12-34` URL form to the `12:34` REST API form. */
export function normalizeFigmaNodeId(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value).trim();
  } catch {
    return '';
  }
  return /^\d+-\d+$/.test(decoded) ? decoded.replace('-', ':') : decoded;
}

/**
 * Parses either a copied Figma URL or an explicit file-key/node-id pair.
 * Only figma.com URLs and known document path kinds are accepted.
 */
export function parseFigmaReference(
  input: string,
  explicitNodeId?: string
): FigmaReferenceResult {
  let fileKey = input.trim();
  let nodeId = explicitNodeId?.trim() ?? '';

  if (/^https?:\/\//i.test(fileKey)) {
    let url: URL;
    try {
      url = new URL(fileKey);
    } catch {
      return { ok: false, error: 'Figma URL is malformed.' };
    }
    if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname.toLowerCase())) {
      return { ok: false, error: 'Figma URL must use https://figma.com.' };
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2 || !FIGMA_PATH_KIND.has(segments[0]!.toLowerCase())) {
      return { ok: false, error: 'Figma URL must reference a design, file, prototype, or board.' };
    }
    fileKey = segments[1]!;
    nodeId = explicitNodeId?.trim() || url.searchParams.get('node-id')?.trim() || '';
  }

  try {
    fileKey = decodeURIComponent(fileKey).trim();
  } catch {
    return { ok: false, error: 'Figma file key contains malformed URL encoding.' };
  }
  nodeId = normalizeFigmaNodeId(nodeId);
  if (!FILE_KEY.test(fileKey)) {
    return { ok: false, error: `Invalid Figma file key "${fileKey}".` };
  }
  if (!nodeId || !NODE_ID.test(nodeId)) {
    return { ok: false, error: `Invalid Figma node ID "${nodeId}".` };
  }
  return { ok: true, reference: { fileKey, nodeId } };
}
