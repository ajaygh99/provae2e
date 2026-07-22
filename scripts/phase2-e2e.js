const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = mkdtempSync(path.join(os.tmpdir(), 'prova-phase2-e2e-'));
  const schema = path.join(temp, 'user.schema.json');
  const dataFile = path.join(temp, 'users.json');
  writeFileSync(schema, JSON.stringify({
    type: 'object', required: ['email'], properties: {
      email: { type: 'string', format: 'email' },
      profile: { type: 'object', properties: { age: { type: 'integer', minimum: 18, maximum: 65 } } }
    }
  }));
  execFileSync(process.execPath, [path.join(root, 'dist', 'cli', 'run.js'), 'data',
    '--schema', schema, '--count', '2', '--format', 'json', '--seed', '123', '--output', dataFile],
  { cwd: root, stdio: 'pipe' });
  const records = JSON.parse(readFileSync(dataFile, 'utf-8'));
  if (!Array.isArray(records) || records.length !== 2 || !records[0].email.includes('@')) {
    throw new Error('Faker CLI E2E flow did not create two valid records');
  }

  const { PerformanceStore } = require(path.join(root, 'dist', 'perf', 'performance-store.js'));
  const database = path.join(temp, 'performance.sqlite');
  const run = {
    url: 'https://api.example.com', vus: 5, durationSeconds: 10,
    p50ResponseTimeMs: 40, p95ResponseTimeMs: 80, p99ResponseTimeMs: 120,
    errorRate: 0, requestsPerSecond: 30, status: 'PASS', timestamp: new Date().toISOString()
  };
  const first = await PerformanceStore.open(database);
  await first.setBaseline(run);
  await first.addRun(run);
  first.close();
  const reopened = await PerformanceStore.open(database);
  if (!reopened.getBaseline(run.url, 5, 10) || reopened.listRuns().length !== 1) {
    throw new Error('SQLite E2E flow did not survive database reopen');
  }
  reopened.close();
  process.stdout.write('Phase 2 E2E passed: Faker CLI + SQLite persistence\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
