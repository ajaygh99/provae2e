import axios from 'axios';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractAcceptanceCriteria,
  generateTestsFromSpec
} from '../../src/generators/spec-test-generator';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const BROWSER_TEST = `import { test, expect } from '@playwright/test';
test('generated browser case', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});`;

describe('extractAcceptanceCriteria', () => {
  it('groups Given/When/Then scenarios and extracts bullet and numbered criteria', () => {
    const result = extractAcceptanceCriteria(`
# Ticket
Given a signed-out visitor
When they open the login page
Then the login form is visible

- Invalid credentials show an error
2. Successful login redirects to the dashboard
`);

    expect(result).toEqual([
      'Given a signed-out visitor When they open the login page Then the login form is visible',
      'Invalid credentials show an error',
      'Successful login redirects to the dashboard'
    ]);
  });

  it('extracts plain lines under an Acceptance Criteria heading and de-duplicates them', () => {
    const result = extractAcceptanceCriteria(`
## Acceptance Criteria
The endpoint returns HTTP 200
The endpoint returns HTTP 200
- The response includes an id

## Notes
This is not a criterion
`);

    expect(result).toEqual(['The endpoint returns HTTP 200', 'The response includes an id']);
  });
});

describe('generateTestsFromSpec', () => {
  let tempDir: string;
  let specFile: string;
  let outputDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'prova-spec-generation-'));
    specFile = path.join(tempDir, 'ticket.md');
    outputDir = path.join(tempDir, 'generated');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('calls Ollama once per criterion and writes valid TypeScript files', async () => {
    writeFileSync(specFile, '- Login page loads\n- Invalid login shows an error\n', 'utf-8');
    mockedAxios.post
      .mockResolvedValueOnce({ data: { response: `\`\`\`typescript\n${BROWSER_TEST}\n\`\`\`` } })
      .mockResolvedValueOnce({ data: { response: BROWSER_TEST.replace('browser case', 'error case') } });

    const result = await generateTestsFromSpec({
      specFile,
      type: 'browser',
      url: 'https://example.com',
      outputDir,
      endpoint: 'http://localhost:11434/api/generate',
      model: 'test-model',
      timeoutMs: 1234
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toHaveLength(2);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post.mock.calls[0][0]).toBe('http://localhost:11434/api/generate');
    expect(mockedAxios.post.mock.calls[0][1]).toMatchObject({ model: 'test-model', stream: false });
    expect((mockedAxios.post.mock.calls[0][1] as { prompt: string }).prompt).toContain('Login page loads');
    expect((mockedAxios.post.mock.calls[0][1] as { prompt: string }).prompt).toContain('https://example.com');
    expect(mockedAxios.post.mock.calls[0][2]).toEqual({ timeout: 1234 });
    for (const file of result.files) {
      expect(existsSync(file)).toBe(true);
      const source = readFileSync(file, 'utf-8');
      expect(source).toContain("from '@playwright/test'");
      expect(source).not.toContain('```');
    }
  });

  it('uses API-specific prompt guidance', async () => {
    writeFileSync(specFile, '1. GET user returns status 200', 'utf-8');
    const apiSource = `import { test, expect } from '@playwright/test';
test('generated api case', async ({ request }) => {
  const response = await request.get('https://example.com/users/1');
  expect(response.status()).toBe(200);
});`;
    mockedAxios.post.mockResolvedValueOnce({ data: { response: apiSource } });

    const result = await generateTestsFromSpec({ specFile, type: 'api', url: 'https://example.com', outputDir });

    expect(result.ok).toBe(true);
    const prompt = (mockedAxios.post.mock.calls[0][1] as { prompt: string }).prompt;
    expect(prompt).toContain('APIRequestContext');
    expect(prompt).toContain('Test type: api');
  });

  it('applies the shared acceptance-criteria parser to already-loaded JIRA text', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: BROWSER_TEST } });

    const result = await generateTestsFromSpec({
      specText: 'Acceptance Criteria\n- User can sign in',
      sourceLabel: 'JIRA ticket PROJ-123',
      type: 'browser',
      url: 'https://example.com',
      outputDir
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.criteria).toEqual(['User can sign in']);
  });

  it('includes factory-generated request data in API generation prompts', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: BROWSER_TEST } });
    const result = await generateTestsFromSpec({
      specText: '- Create a user',
      type: 'api',
      url: 'https://example.com/users',
      outputDir,
      requestBody: { email: 'user@example.com', active: true }
    });
    expect(result.ok).toBe(true);
    const request = mockedAxios.post.mock.calls[0][1] as { prompt: string };
    const prompt = request.prompt;
    expect(prompt).toContain('Use this generated request body');
    expect(prompt).toContain('"email": "user@example.com"');
  });

  it('returns a clear error for an empty spec without calling Ollama', async () => {
    writeFileSync(specFile, '  \n', 'utf-8');
    const result = await generateTestsFromSpec({ specFile, type: 'browser', url: 'https://example.com', outputDir });
    expect(result).toEqual({ ok: false, error: `Spec is empty: ${specFile}` });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns a clear error when no criteria can be extracted', async () => {
    writeFileSync(specFile, '# Ticket\nGeneral background paragraph.\n', 'utf-8');
    const result = await generateTestsFromSpec({ specFile, type: 'browser', url: 'https://example.com', outputDir });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('No acceptance criteria found');
  });

  it('returns a clear error for missing files, invalid types, and invalid URLs', async () => {
    const missing = await generateTestsFromSpec({ specFile, type: 'browser', url: 'https://example.com', outputDir });
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain('Test generation failed');

    writeFileSync(specFile, '- Criterion', 'utf-8');
    const badType = await generateTestsFromSpec({
      specFile,
      type: 'mobile' as 'browser',
      url: 'https://example.com',
      outputDir
    });
    expect(badType.ok).toBe(false);
    expect(!badType.ok && badType.error).toContain('Invalid generation type');

    const badUrl = await generateTestsFromSpec({ specFile, type: 'browser', url: 'not-a-url', outputDir });
    expect(badUrl.ok).toBe(false);
    expect(!badUrl.ok && badUrl.error).toContain('Invalid target URL');
  });

  it('returns Ollama and malformed-response failures without writing partial output', async () => {
    writeFileSync(specFile, '- Criterion one\n- Criterion two', 'utf-8');
    mockedAxios.post
      .mockResolvedValueOnce({ data: { response: BROWSER_TEST } })
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const failedCall = await generateTestsFromSpec({ specFile, type: 'browser', url: 'https://example.com', outputDir });
    expect(failedCall.ok).toBe(false);
    expect(!failedCall.ok && failedCall.error).toContain('ECONNREFUSED');
    expect(existsSync(outputDir)).toBe(false);

    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValueOnce({ data: { response: 'Here is your test.' } });
    writeFileSync(specFile, '- One criterion', 'utf-8');
    const malformed = await generateTestsFromSpec({ specFile, type: 'browser', url: 'https://example.com', outputDir });
    expect(malformed.ok).toBe(false);
    expect(!malformed.ok && malformed.error).toContain('not a runnable Playwright test skeleton');
  });

  it('refuses to overwrite an existing generated test', async () => {
    writeFileSync(specFile, '- Login page loads', 'utf-8');
    const expectedFile = path.join(outputDir, 'browser-001-login-page-loads.spec.ts');
    writeFileSync(path.join(tempDir, 'placeholder'), 'x');
    // mkdirSync is avoided by creating the parent through a successful first generation.
    mockedAxios.post.mockResolvedValueOnce({ data: { response: BROWSER_TEST } });
    const first = await generateTestsFromSpec({ specFile, type: 'browser', url: 'https://example.com', outputDir });
    expect(first.ok).toBe(true);
    expect(existsSync(expectedFile)).toBe(true);

    jest.clearAllMocks();
    const second = await generateTestsFromSpec({ specFile, type: 'browser', url: 'https://example.com', outputDir });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toContain('Refusing to overwrite');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
