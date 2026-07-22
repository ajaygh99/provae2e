import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkReleaseApproval } = require('../../scripts/check-release-approval.js');

function makeFixtureRoot(version: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-release-approval-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  fs.mkdirSync(path.join(root, 'releases'));
  return root;
}

describe('checkReleaseApproval', () => {
  let root: string;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('is not approved when no approval file exists at all', () => {
    root = makeFixtureRoot('0.1.0');
    const result = checkReleaseApproval(root);
    expect(result.approved).toBe(false);
    expect(result.version).toBe('0.1.0');
  });

  it('is approved only when the declared package version has an approval file', () => {
    root = makeFixtureRoot('0.1.0');
    fs.writeFileSync(path.join(root, 'releases', 'v0.1.0-approval.md'), 'approved');
    const result = checkReleaseApproval(root);
    expect(result.approved).toBe(true);
    expect(result.approvalPath).toBe(path.join(root, 'releases', 'v0.1.0-approval.md'));
  });

  it('is NOT approved when some unrelated approval file is present ("some approval" is not enough)', () => {
    root = makeFixtureRoot('0.1.0');
    fs.writeFileSync(path.join(root, 'releases', 'v9.9.9-approval.md'), 'approved');
    const result = checkReleaseApproval(root);
    expect(result.approved).toBe(false);
  });

  it('does not accept an approval for a different version', () => {
    root = makeFixtureRoot('0.1.0');
    fs.writeFileSync(path.join(root, 'releases', 'v0.1.1-approval.md'), 'approved');
    const result = checkReleaseApproval(root);
    expect(result.approved).toBe(false);
  });

  it('rejects malformed package versions', () => {
    root = makeFixtureRoot('not-a-version');
    expect(() => checkReleaseApproval(root)).toThrow('Invalid semver version');
  });
});
