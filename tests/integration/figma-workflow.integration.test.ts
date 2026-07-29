import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { figmaCommand } from '../../src/cli/run';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Figma hardened CLI workflow', () => {
  let directory = '';

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    process.env['PROVA_CREDENTIAL_KEY'] = 'integration-credential-key';
    process.env['FIGMA_OAUTH_ACCESS_TOKEN'] = 'oauth-integration-secret';
    process.env['FIGMA_OAUTH_EXPIRES_AT'] = '2030-01-01T00:00:00.000Z';
    mockedAxios.isAxiosError.mockReturnValue(false);
  });

  afterEach(async () => {
    delete process.env['PROVA_CREDENTIAL_KEY'];
    delete process.env['FIGMA_OAUTH_ACCESS_TOKEN'];
    delete process.env['FIGMA_OAUTH_EXPIRES_AT'];
    process.exitCode = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('authenticates, persists encrypted credentials, ingests a frame, and generates runnable tests', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'prova-figma-workflow-'));
    const database = path.join(directory, 'credentials.sqlite');
    const output = path.join(directory, 'generated');
    await figmaCommand({
      auth: true, profile: 'design-team', output, database
    });

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        nodes: {
          '12:34': {
            document: {
              type: 'FRAME',
              name: 'Login',
              children: [
                { type: 'TEXT', name: 'Heading', characters: 'Welcome back' },
                { type: 'INSTANCE', name: 'Email Field' },
                { type: 'INSTANCE', name: 'Login Button' }
              ]
            }
          }
        }
      }
    });
    await figmaCommand({
      auth: false,
      sync: 'https://www.figma.com/design/AbCdEf123/Login?node-id=12-34',
      node: '12-34',
      profile: 'design-team',
      url: 'https://app.example.com/login',
      output,
      database
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.figma.com/v1/files/AbCdEf123/nodes',
      expect.objectContaining({
        headers: { Authorization: 'Bearer oauth-integration-secret' },
        params: { ids: '12:34' }
      })
    );
    const generated = await readFile(path.join(output, '003-login-button.spec.ts'), 'utf8');
    expect(generated).toContain("getByRole('button'");
    expect(generated).toContain('https://app.example.com/login');
    expect(generated).toContain('component.click()');
    const databaseBytes = await readFile(database);
    expect(databaseBytes.includes(Buffer.from('oauth-integration-secret'))).toBe(false);
  });
});
