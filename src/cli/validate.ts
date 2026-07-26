/**
 * CLI input validation for `qe-tool run` — fail-fast checks so malformed
 * flags surface as one clear error message (exit code 1) instead of a raw
 * stack trace, or worse, a silent wrong default (e.g. an unrecognised
 * --method falling through to GET inside the API runner).
 */
import { SUPPORTED_DEVICES } from '../runners/mobile-runner.js';
import {
  parseHeaders,
  RUN_TYPES,
  validateApiPayload,
  validateDevice,
  validateHttpUrl,
  validatePositiveInteger,
  validateRunType,
  validateWorkers,
  type HttpHeaders
} from '../core/input-validator.js';

/** Supported `--type` values. */
export const VALID_RUN_TYPES = RUN_TYPES;
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
  timeout?: string;
  headers?: string;
  deviceCloud?: string;
  browserstackUsername?: string;
  browserstackKey?: string;
  browserstackParallel?: string;
  browserstackVideo?: string;
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
  /** Parsed custom HTTP headers. */
  headers?: HttpHeaders;
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

  const urlError = validateHttpUrl(input.url);
  if (urlError) errors.push(urlError);
  const typeError = validateRunType(input.type);
  if (typeError) errors.push(typeError);

  if (!(VALID_ENVIRONMENTS as readonly string[]).includes(input.env)) {
    errors.push(`Invalid --env "${input.env}": must be one of ${VALID_ENVIRONMENTS.join(', ')}`);
  }

  if (!(VALID_SCOPES as readonly string[]).includes(input.scope)) {
    errors.push(`Invalid --scope "${input.scope}": must be one of ${VALID_SCOPES.join(', ')}`);
  }

  const workersError = validateWorkers(input.workers);
  if (workersError) errors.push(workersError);

  if (input.retries !== undefined) {
    const retries = Number(input.retries);
    if (!Number.isInteger(retries) || retries < 0 || retries > 3) {
      errors.push(`Invalid --retries "${input.retries}": must be an integer between 0 and 3`);
    }
  }

  if (input.timeout !== undefined) {
    const timeoutError = validatePositiveInteger(input.timeout);
    if (timeoutError) errors.push(timeoutError);
  }

  if (input.type === 'mobile' || input.type === 'all') {
    if (input.deviceCloud && !['local', 'browserstack'].includes(input.deviceCloud)) {
      errors.push(`Invalid --device-cloud "${input.deviceCloud}": must be one of local, browserstack`);
    }
    if (!input.deviceCloud || input.deviceCloud === 'local') {
      const deviceError = validateDevice(input.device);
      if (deviceError) errors.push(`${deviceError}. Common aliases: ${SUPPORTED_DEVICES.join(', ')}`);
    }
    if (input.deviceCloud === 'browserstack') {
      const username = input.browserstackUsername ?? process.env['BROWSERSTACK_USERNAME'];
      const key = input.browserstackKey ?? process.env['BROWSERSTACK_ACCESS_KEY'];
      if (!username) errors.push('BrowserStack username is required via --browserstack-username or BROWSERSTACK_USERNAME');
      if (!key) errors.push('BrowserStack access key is required via --browserstack-key or BROWSERSTACK_ACCESS_KEY');
      if (input.browserstackParallel !== undefined) {
        const parallel = Number(input.browserstackParallel);
        if (!Number.isInteger(parallel) || parallel < 1 || parallel > 25) {
          errors.push('Invalid --browserstack-parallel: must be an integer between 1 and 25');
        }
      }
      if (
        input.browserstackVideo !== undefined &&
        !['true', 'false'].includes(input.browserstackVideo.toLowerCase())
      ) {
        errors.push('Invalid --browserstack-video: must be true or false');
      }
    }
  } else if (
    input.deviceCloud ||
    input.browserstackUsername ||
    input.browserstackKey ||
    input.browserstackParallel ||
    input.browserstackVideo
  ) {
    errors.push('Device-cloud options require --type mobile or --type all');
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
        errors.push(...validateApiPayload(parsedBody));
      }
    }

    if (input.headers !== undefined) {
      const parsedHeaders = parseHeaders(input.headers);
      errors.push(...parsedHeaders.errors);
      result.headers = parsedHeaders.headers;
    }
  }

  result.valid = errors.length === 0;
  return result;
}
