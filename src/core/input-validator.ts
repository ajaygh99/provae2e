import { validateHeaderName, validateHeaderValue } from 'node:http';
import { resolveDeviceKey } from '../runners/mobile-runner.js';

/** Supported test runner types. */
export const RUN_TYPES = ['browser', 'api', 'mobile', 'all'] as const;

/** A validated collection of HTTP headers. */
export type HttpHeaders = Record<string, string>;

/** Returns an error when a value is not an absolute HTTP(S) URL. */
export function validateHttpUrl(value: string, label = '--url'): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return undefined;
  } catch {
    // The common error below is more useful than URL's platform-specific exception.
  }
  return `Invalid ${label} "${value}": must be an absolute http:// or https:// URL`;
}

/** Returns an error when a runner type is unsupported. */
export function validateRunType(value: string): string | undefined {
  return (RUN_TYPES as readonly string[]).includes(value)
    ? undefined
    : `Invalid --type "${value}": must be one of ${RUN_TYPES.join(', ')}`;
}

/** Splits the CLI's comma-separated device option into individual names. */
export function parseDevices(value: string): string[] {
  return value.split(',').map((device) => device.trim());
}

/** Returns an error when any requested device is not known to Playwright. */
export function validateDevice(value: string): string | undefined {
  const devices = parseDevices(value);
  const invalidDevice = devices.find((device) => device.length === 0 || !resolveDeviceKey(device));
  return invalidDevice === undefined
    ? undefined
    : `Invalid --device "${invalidDevice}": must match a Playwright device name`;
}

/** Returns an error unless workers is an integer from 1 through 16. */
export function validateWorkers(value: string | number): string | undefined {
  const workers = Number(value);
  return Number.isInteger(workers) && workers >= 1 && workers <= 16
    ? undefined
    : `Invalid --workers "${value}": must be an integer between 1 and 16`;
}

/** Returns an error unless a timeout is a positive integer. */
export function validatePositiveInteger(value: string | number, label = '--timeout'): string | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0
    ? undefined
    : `Invalid ${label} "${value}": must be a positive integer`;
}

/** Validates header names and values using Node's HTTP rules. */
export function validateHeaders(headers: unknown, label = '--headers'): string[] {
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
    return [`Invalid ${label}: must be a JSON object containing string values`];
  }
  const errors: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      errors.push(`Invalid ${label}: header "${name}" must have a string value`);
      continue;
    }
    try {
      validateHeaderName(name);
      validateHeaderValue(name, value);
    } catch {
      errors.push(`Invalid ${label}: "${name}" is not a valid HTTP header`);
    }
  }
  return errors;
}

/** Parses and validates a JSON object supplied as custom HTTP headers. */
export function parseHeaders(value: string): { headers?: HttpHeaders; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { errors: ['Invalid --headers: must be valid JSON'] };
  }
  const errors = validateHeaders(parsed);
  return errors.length === 0 ? { headers: parsed as HttpHeaders, errors } : { errors };
}

/** Rejects API payload values that cannot be represented safely as JSON. */
export function validateApiPayload(payload: unknown): string[] {
  if (payload === undefined) return [];
  try {
    const json = JSON.stringify(payload);
    return json === undefined ? ['Invalid API payload: value is not JSON serializable'] : [];
  } catch {
    return ['Invalid API payload: value is not JSON serializable'];
  }
}
