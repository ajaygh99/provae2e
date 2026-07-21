/**
 * CLI input validation for `qe-tool run` — fail-fast checks so malformed
 * flags surface as one clear error message (exit code 1) instead of a raw
 * stack trace, or worse, a silent wrong default (e.g. an unrecognised
 * --method falling through to GET inside the API runner).
 */
import { resolveDeviceKey, SUPPORTED_DEVICES } from '../runners/mobile-runner.js';

/** Supported `--type` values. */
export const VALID_RUN_TYPES = ['browser', 'api', 'mobile', 'all'] as const;
export type RunType = (typeof VALID_RUN_TYPES)[number];

/** Supported `--method` values. */
export const VALID_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;

/** Supported `--env` values. */
export const VALID_ENVIRONMENTS = ['dev', 'qe', 'uat', 'staging', 'prod'] as const;

/** Supported `--scope` values. */
export const VALID_SCOPES = ['full', 'cr', 'smoke', 'component'] as const;

/** Raw `run` CLI option values as Commander hands them to us — all strings. */
export interface RunOptionsInput {
  url: string;
  type: string;
  device: string;
  workers: string;
  env: string;
  scope: string;
  method: string;
  expectStatus: string;
  graphql?: string;
  body?: string;
  retries?: string;
}

/** Result of validating a full set of `run` CLI options. */
export interface ValidationResult {
  /** True when every option was valid. */
  valid: boolean;
  /** Every violation found, in flag order — not just the first. */
  errors: string[];
  /** Parsed GraphQL variables, when --graphql and --body were both given and --body parsed to a JSON object. */
  graphqlVariables?: Record<string, unknown>;
  /** Parsed REST body, when --graphql was not given and --body parsed successfully. */
  restBody?: unknown;
}

/** True when `value` parses as an absolute http(s) URL. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** True when `device` matches a supported alias or an exact Playwright device key. */
function isSupportedDevice(device: string): boolean {
  return resolveDeviceKey(device) !== undefined;
}

/**
 * Validates the full set of `qe-tool run` CLI options before any runner executes.
 * Type-specific checks (device, method, status code, body) only apply when that
 * type is actually in play (`--type mobile`/`all` for device, `--type api`/`all`
 * for method/status/body).
 *
 * @param input - The raw string option values from Commander.
 * @returns Every validation error found, plus any pre-parsed request body/variables.
 */
export function validateRunOptions(input: RunOptionsInput): ValidationResult {
  const errors: string[] = [];
  const result: ValidationResult = { valid: true, errors };

  if (!isHttpUrl(input.url)) {
    errors.push(`Invalid --url "${input.url}": must be an absolute http:// or https:// URL`);
  }

  if (!(VALID_RUN_TYPES as readonly string[]).includes(input.type)) {
    errors.push(`Invalid --type "${input.type}": must be one of ${VALID_RUN_TYPES.join(', ')}`);
  }

  if (!(VALID_ENVIRONMENTS as readonly string[]).includes(input.env)) {
    errors.push(`Invalid --env "${input.env}": must be one of ${VALID_ENVIRONMENTS.join(', ')}`);
  }

  if (!(VALID_SCOPES as readonly string[]).includes(input.scope)) {
    errors.push(`Invalid --scope "${input.scope}": must be one of ${VALID_SCOPES.join(', ')}`);
  }

  const workers = Number(input.workers);
  if (!Number.isInteger(workers) || workers < 1) {
    errors.push(`Invalid --workers "${input.workers}": must be a positive integer`);
  }

  if (input.type === 'mobile' || input.type === 'all') {
    if (!isSupportedDevice(input.device)) {
      errors.push(`Invalid --device "${input.device}": must be one of ${SUPPORTED_DEVICES.join(', ')}`);
    }
  }

  if (input.type === 'api' || input.type === 'all') {
    if (!(VALID_HTTP_METHODS as readonly string[]).includes(input.method)) {
      errors.push(`Invalid --method "${input.method}": must be one of ${VALID_HTTP_METHODS.join(', ')}`);
    }

    const statusCode = Number(input.expectStatus);
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      errors.push(
        `Invalid --expect-status "${input.expectStatus}": must be an integer HTTP status code between 100 and 599`
      );
    }

    if (input.body !== undefined) {
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(input.body);
      } catch {
        errors.push('Invalid --body: must be valid JSON');
      }

      if (parsedBody !== undefined) {
        if (input.graphql) {
          if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
            errors.push('Invalid --body for --graphql: variables must be a JSON object');
          } else {
            result.graphqlVariables = parsedBody as Record<string, unknown>;
          }
        } else {
          result.restBody = parsedBody;
        }
      }
    }
  }

  result.valid = errors.length === 0;
  return result;
}
