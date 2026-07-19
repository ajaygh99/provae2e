import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeNextVersion, checkReleaseApproval } = require('../../scripts/check-release-approval.js');

function makeFixtureRoot(version: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-release-approval-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  fs.mkdirSync(path.join(root, 'releases'));
  return root;
}

describe('computeNextVersion', () => {
  it('patch-bumps a semver version', () => {
    expect(computeNextVersion('0.1.0')).toBe('0.1.1');
    expect(computeNextVersion('1.2.9')).toBe('1.2.10');
  });

  it('throws on a malformed version string', () => {
    expect(() => computeNextVersion('not-a-version')).toThrow();
  });
});

describe('checkReleaseApproval', () => {
  let root: string;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('is not approved when no approval file exists at all', () => {
    root = makeFixtureRoot('0.1.0');
    const result = checkReleaseApproval(root);
    expect(result.approved).toBe(false);
    expect(result.nextVersion).toBe('0.1.1');
  });

  it('is NOT approved when only the current (already-published) version has an approval file', () => {
    // Regression guard: the old behavior checked v${CURRENT_VERSION}-approval.md,
    // which is the wrong file - that version is already published.
    root = makeFixtureRoot('0.1.0');
    fs.writeFileSync(path.join(root, 'releases', 'v0.1.0-approval.md'), 'approved');
    const result = checkReleaseApproval(root);
    expect(result.approved).toBe(false);
  });

  it('is NOT approved when some unrelated approval file is present ("some approval" is not enough)', () => {
    root = makeFixtureRoot('0.1.0');
    fs.writeFileSync(path.join(root, 'releases', 'v9.9.9-approval.md'), 'approved');
    const result = checkReleaseApproval(root);
    expect(result.approved).toBe(false);
  });

  it('is approved only when the exact next-version approval file exists', () => {
    root = makeFixtureRoot('0.1.0');
    fs.writeFileSync(path.join(root, 'releases', 'v0.1.1-approval.md'), 'approved');
    const result = checkReleaseApproval(root);
    expect(result.approved).toBe(true);
    expect(result.approvalPath).toBe(path.join(root, 'releases', 'v0.1.1-approval.md'));
  });
});
