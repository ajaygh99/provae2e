/**
 * API Runner — REST + GraphQL test execution via Playwright's APIRequestContext.
 * Sends a request, then asserts status code, response time, and (optionally) response schema.
 */
import { request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { log } from '../core/logger.js';
import { executeWithRetry } from '../core/retry-handler.js';

/** HTTP methods supported for REST requests. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** JSON value types recognised by {@link validateSchema}. */
export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

/** Maps expected field names to their required JSON type, for lightweight response schema validation. */
export type ResponseSchema = Record<string, SchemaFieldType>;

/** A GraphQL query or mutation and its variables. */
export interface GraphQLRequest {
  /** The GraphQL query or mutation document. */
  query: string;
  /** Variables passed alongside the query. */
  variables?: Record<string, unknown>;
}

/** Options accepted by {@link runApiTest}. */
export interface ApiRunnerOptions {
  /** Target URL to send the request to. */
  url: string;
  /** REST method to use. Ignored when {@link ApiRunnerOptions.graphql} is set (always POST). Defaults to GET. */
  method?: HttpMethod;
  /** JSON-serialisable request body, for POST/PUT/DELETE. */
  body?: unknown;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** When set, sends a GraphQL request instead of a plain REST call. */
  graphql?: GraphQLRequest;
  /** Expected HTTP status code. Defaults to 200. */
  expectedStatus?: number;
  /** Optional flat schema the JSON response body (or GraphQL `data`) must satisfy. */
  schema?: ResponseSchema;
  /** Maximum acceptable response time, in milliseconds. Defaults to 5000. */
  maxResponseTimeMs?: number;
  /** Request timeout, in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Retry count after the initial attempt. Defaults to 0 for programmatic use. */
  retries?: number;
  /** Initial exponential-backoff delay. Defaults to 1000ms. */
  retryBaseDelayMs?: number;
}

/** Outcome of a single API test run. */
export interface ApiRunResult {
  /** PASS if the request met every configured assertion, FAIL otherwise. */
  status: 'PASS' | 'FAIL';
  /** The URL that was tested. */
  url: string;
  /** The HTTP method used. */
  method: string;
  /** The HTTP status code returned, when a response was received. */
  statusCode?: number;
  /** Wall-clock duration of the request, in milliseconds. */
  durationMs: number;
  /** A truncated preview of the response body. */
  responseSummary?: string;
  /** Error message, populated only when status is FAIL. */
  error?: string;
}

/** Classifies a parsed JSON value into a {@link SchemaFieldType}. */
function typeOfValue(value: unknown): SchemaFieldType {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const jsType = typeof value;
  if (jsType === 'string' || jsType === 'number' || jsType === 'boolean' || jsType === 'object') {
    return jsType;
  }
  return 'null';
}

/**
 * Validates a parsed JSON body against a flat field-name-to-type schema.
 *
 * @param body - The parsed JSON response body to check.
 * @param schema - Expected field names and their JSON types.
 * @returns A list of human-readable mismatch descriptions; empty when the body satisfies the schema.
 */
export function validateSchema(body: unknown, schema: ResponseSchema): string[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return ['Response body is not a JSON object'];
  }
  const record = body as Record<string, unknown>;
  const errors: string[] = [];
  for (const [field, expectedType] of Object.entries(schema)) {
    if (!(field in record)) {
      errors.push(`Missing field "${field}"`);
      continue;
    }
    const actualType = typeOfValue(record[field]);
    if (actualType !== expectedType) {
      errors.push(`Field "${field}" expected type "${expectedType}" but got "${actualType}"`);
    }
  }
  return errors;
}

/** Truncates response body text to a safe preview length. */
function summarize(bodyText: string, limit = 300): string {
  const trimmed = bodyText.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

/** Dispatches the configured REST or GraphQL request on the given context. */
async function sendRequest(context: APIRequestContext, options: ApiRunnerOptions): Promise<APIResponse> {
  const { url, headers } = options;

  if (options.graphql) {
    return context.post(url, {
      headers,
      data: { query: options.graphql.query, variables: options.graphql.variables ?? {} }
    });
  }

  const method = options.method ?? 'GET';
  switch (method) {
    case 'POST':
      return context.post(url, { headers, data: options.body });
    case 'PUT':
      return context.put(url, { headers, data: options.body });
    case 'DELETE':
      return context.delete(url, { headers, data: options.body });
    case 'GET':
    default:
      return context.get(url, { headers });
  }
}

/**
 * Runs a REST or GraphQL API test against a URL using Playwright's APIRequestContext.
 * Asserts the response status code, response time, and (optionally) a response schema.
 * Never throws — request and assertion failures are reported as a FAIL result.
 *
 * @param options - Target URL, method/GraphQL payload, and assertions to apply.
 * @returns The PASS/FAIL result with duration and a response summary.
 */
async function runApiTestOnce(options: ApiRunnerOptions): Promise<ApiRunResult> {
  const { url } = options;
  const method = options.graphql ? 'POST' : options.method ?? 'GET';
  const expectedStatus = options.expectedStatus ?? 200;
  const maxResponseTimeMs = options.maxResponseTimeMs ?? 5000;
  const startedAt = Date.now();

  log.info('Sending API request', { url, method });

  let context: APIRequestContext | undefined;
  try {
    context = await playwrightRequest.newContext({ timeout: options.timeoutMs ?? 30000 });
    const response = await sendRequest(context, options);
    const statusCode = response.status();
    const bodyText = await response.text();
    const durationMs = Date.now() - startedAt;
    const responseSummary = summarize(bodyText);

    if (statusCode !== expectedStatus) {
      const error = `Expected status ${expectedStatus} but got ${statusCode}`;
      log.error('API run failed', undefined);
      return { status: 'FAIL', url, method, statusCode, durationMs, responseSummary, error };
    }

    if (durationMs > maxResponseTimeMs) {
      const error = `Response time ${durationMs}ms exceeded threshold of ${maxResponseTimeMs}ms`;
      log.error('API run failed', undefined);
      return { status: 'FAIL', url, method, statusCode, durationMs, responseSummary, error };
    }

    let parsedBody: unknown;
    try {
      parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      parsedBody = undefined;
    }

    if (options.graphql && typeof parsedBody === 'object' && parsedBody !== null && 'errors' in (parsedBody as Record<string, unknown>)) {
      const gqlErrors = (parsedBody as Record<string, unknown>)['errors'];
      if (Array.isArray(gqlErrors) && gqlErrors.length > 0) {
        const error = `GraphQL response contained errors: ${JSON.stringify(gqlErrors)}`;
        log.error('API run failed', undefined);
        return { status: 'FAIL', url, method, statusCode, durationMs, responseSummary, error };
      }
    }

    if (options.schema) {
      const schemaTarget = options.graphql && typeof parsedBody === 'object' && parsedBody !== null
        ? (parsedBody as Record<string, unknown>)['data']
        : parsedBody;
      const schemaErrors = validateSchema(schemaTarget, options.schema);
      if (schemaErrors.length > 0) {
        const error = `Schema validation failed: ${schemaErrors.join('; ')}`;
        log.error('API run failed', undefined);
        return { status: 'FAIL', url, method, statusCode, durationMs, responseSummary, error };
      }
    }

    log.success('API run passed', { url, method, statusCode, durationMs });
    return { status: 'PASS', url, method, statusCode, durationMs, responseSummary };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    log.error('API run failed', err);
    return { status: 'FAIL', url, method, durationMs, error: message };
  } finally {
    if (context) {
      try {
        await context.dispose();
      } catch (err) {
        log.warn('API run: failed to dispose request context cleanly', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
}

/** Runs an API test and retries failed results using exponential backoff. */
export async function runApiTest(options: ApiRunnerOptions): Promise<ApiRunResult> {
  return executeWithRetry(() => runApiTestOnce(options), {
    maxRetries: options.retries ?? 0,
    baseDelayMs: options.retryBaseDelayMs ?? 1000,
    shouldRetry: (result) => result.status === 'FAIL'
  });
}
