import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { verifyBrowserStackEvidence } = require('../../scripts/verify-browserstack-evidence.js') as {
  verifyBrowserStackEvidence: (directory: string, count: number) => {
    verified: boolean;
    actualCount: number;
    uniqueSessions: number;
  };
};

describe('verifyBrowserStackEvidence', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function evidenceDirectory(): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'prova-browserstack-evidence-'));
    temporaryDirectories.push(directory);
    return directory;
  }

  function writeRun(directory: string, index: number, overrides: Record<string, unknown> = {}): void {
    const screenshotPath = path.join(directory, `session-${index}.png`);
    writeFileSync(screenshotPath, 'png');
    writeFileSync(path.join(directory, `run-${index}.json`), JSON.stringify({
      runs: [{
        status: 'PASS',
        provider: 'browserstack',
        sessionId: `session-${index}`,
        device: index % 2 ? 'iPhone 14' : 'Google Pixel 7',
        videoUrl: `https://browserstack.test/video/${index}`,
        logUrls: [`https://browserstack.test/log/${index}`],
        screenshotPath,
        ...overrides
      }]
    }));
  }

  it('accepts unique passing sessions with complete artifacts', () => {
    const directory = evidenceDirectory();
    mkdirSync(directory, { recursive: true });
    writeRun(directory, 1);
    writeRun(directory, 2);

    expect(verifyBrowserStackEvidence(directory, 2)).toEqual(expect.objectContaining({
      verified: true,
      actualCount: 2,
      uniqueSessions: 2
    }));
  });

  it('rejects incomplete or duplicated evidence', () => {
    const directory = evidenceDirectory();
    writeRun(directory, 1);
    writeRun(directory, 2, { sessionId: 'session-1', videoUrl: undefined });

    expect(() => verifyBrowserStackEvidence(directory, 2)).toThrow(
      /duplicate sessionId[\s\S]*missing videoUrl/
    );
  });
});
