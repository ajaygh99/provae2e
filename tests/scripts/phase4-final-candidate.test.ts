import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const candidate = JSON.parse(
  fs.readFileSync(
    path.join(root, 'releases/v0.3.5-beta.1-phase4-candidate.json'),
    'utf8',
  ),
) as {
  version: string;
  releaseBranch: string;
  phase4Items: { first: number; last: number; total: number };
  surfaces: string[];
  mergeOrder: Array<number | string>;
  requiredGates: string[];
  checkpointTag: string;
  publishing: {
    prepared: boolean;
    performed: boolean;
    requiresExplicitFinalApproval: boolean;
    npmDistTag: string;
  };
};

describe('final Phase 4 beta candidate', () => {
  it('identifies the complete 45-item release', () => {
    expect(candidate.version).toBe('0.3.5-beta.1');
    expect(candidate.releaseBranch).toBe('release/v0.3.5-phase4');
    expect(candidate.phase4Items).toEqual({ first: 1, last: 45, total: 45 });
  });

  it('records all seven release surfaces', () => {
    expect(candidate.surfaces).toHaveLength(7);
    expect(candidate.surfaces).toEqual(
      expect.arrayContaining([
        'studio-figma',
        'performance',
        'security',
        'analytics',
        'native-mobile-appium',
        'plugins-integrations',
        'documentation-release',
      ]),
    );
  });

  it('records the bottom-up stack and mandatory PowerShell gates', () => {
    expect(candidate.mergeOrder).toEqual([304, 312, 'release-preparation']);
    expect(candidate.requiredGates).toEqual([
      'scripts/validate-phase4-beta.ps1',
      'scripts/verify-phase4-package.ps1',
    ]);
  });

  it('is prepared but not published', () => {
    expect(candidate.publishing).toEqual({
      prepared: true,
      performed: false,
      requiresExplicitFinalApproval: true,
      npmDistTag: 'beta',
    });
    expect(candidate.checkpointTag).toBe('phase4-beta-checkpoint-45-of-45');
  });
});
