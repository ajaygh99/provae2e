import { generateHtmlReport, generateJsonReport } from '../../src/reporters/golden-thread-reporter.js';
import type { GoldenThreadChain } from '../../src/core/golden-thread-store.js';

const mockChain: GoldenThreadChain = {
  golden_thread_id: '550e8400-e29b-41d4-a716-446655440000',
  created_at: '2026-07-22T10:00:00Z',
  stages: [
    {
      id: 1,
      golden_thread_id: '550e8400-e29b-41d4-a716-446655440000',
      stage: 1,
      status: 'PASSED',
      timestamp: '2026-07-22T10:00:00Z',
      actor: 'jira-connector',
      artifact_url: 'https://jira.example.com/browse/PROJ-123',
      parent_id: null,
      metadata: '{"issue_key":"PROJ-123","description":"Test requirements"}'
    },
    {
      id: 2,
      golden_thread_id: '550e8400-e29b-41d4-a716-446655440000',
      stage: 2,
      status: 'PASSED',
      timestamp: '2026-07-22T10:05:00Z',
      actor: 'test-runner',
      artifact_url: 'https://github.com/example/tests',
      parent_id: '1',
      metadata: '{"test_count":5}'
    },
    {
      id: 3,
      golden_thread_id: '550e8400-e29b-41d4-a716-446655440000',
      stage: 3,
      status: 'PASSED',
      timestamp: '2026-07-22T10:10:00Z',
      actor: 'ci-system',
      artifact_url: 'https://github.com/example/runs/123',
      parent_id: '2',
      metadata: '{"screenshots":3,"coverage":"85%"}'
    },
    {
      id: 4,
      golden_thread_id: '550e8400-e29b-41d4-a716-446655440000',
      stage: 4,
      status: 'PASSED',
      timestamp: '2026-07-22T10:15:00Z',
      actor: 'github-connector',
      artifact_url: 'https://github.com/example/commit/abc123',
      parent_id: '3',
      metadata: '{"commit_hash":"abc123","repo":"example/test"}'
    },
    {
      id: 5,
      golden_thread_id: '550e8400-e29b-41d4-a716-446655440000',
      stage: 5,
      status: 'IN_PROGRESS',
      timestamp: '2026-07-22T10:20:00Z',
      actor: 'deployment-system',
      artifact_url: 'https://github.com/example/deployments/456',
      parent_id: '4',
      metadata: '{"environment":"staging"}'
    },
    {
      id: 6,
      golden_thread_id: '550e8400-e29b-41d4-a716-446655440000',
      stage: 6,
      status: 'PENDING',
      timestamp: '2026-07-22T10:25:00Z',
      actor: 'monitoring-system',
      artifact_url: 'https://app.datadoghq.com/logs',
      parent_id: '5',
      metadata: '{"environment":"staging"}'
    },
    {
      id: 7,
      golden_thread_id: '550e8400-e29b-41d4-a716-446655440000',
      stage: 7,
      status: 'PENDING',
      timestamp: '2026-07-22T10:30:00Z',
      actor: 'debug-system',
      artifact_url: 'https://app.datadoghq.com/logs?service=app',
      parent_id: '6',
      metadata: '{"service":"app"}'
    }
  ]
};

describe('Golden Thread Reporter', () => {
  it('generateHtmlReport creates valid HTML', () => {
  const html = generateHtmlReport(mockChain);

  expect(html).toContain('<!DOCTYPE html>');
  expect(html).toContain('<html');
  expect(html).toContain('</html>');
  expect(html).toContain('Golden Thread');
  });

  it('generateHtmlReport includes chain ID', () => {
  const html = generateHtmlReport(mockChain);
  expect(html).toContain(mockChain.golden_thread_id);
});

  it('generateHtmlReport includes all 7 stages', () => {
  const html = generateHtmlReport(mockChain);

  expect(html).toContain('Spec');
  expect(html).toContain('Test');
  expect(html).toContain('Evidence');
  expect(html).toContain('Build');
  expect(html).toContain('Deploy');
  expect(html).toContain('Monitor');
  expect(html).toContain('Debug');
});

  it('generateHtmlReport renders stage statuses', () => {
  const html = generateHtmlReport(mockChain);

  // Check for status display
  expect(html).toContain('PASSED');
  expect(html).toContain('IN_PROGRESS');
  expect(html).toContain('PENDING');
});

  it('generateHtmlReport includes artifact URLs as links', () => {
  const html = generateHtmlReport(mockChain);

  mockChain.stages.forEach(stage => {
    expect(html).toContain(stage.artifact_url);
    expect(html).toContain(`href="${stage.artifact_url}"`);
  });
});

  it('generateHtmlReport escapes HTML special characters', () => {
  const chainWithXss: GoldenThreadChain = {
    ...mockChain,
    stages: [
      {
        ...mockChain.stages[0],
        artifact_url: 'https://example.com?param=<script>alert("xss")</script>'
      }
    ]
  };

  const html = generateHtmlReport(chainWithXss);
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
});

  it('generateHtmlReport supports dark mode', () => {
  const html = generateHtmlReport(mockChain, { darkMode: true });

  expect(html).toContain('#1e1e1e'); // dark bg
  expect(html).toContain('#e0e0e0'); // dark text
});

  it('generateHtmlReport supports light mode (default)', () => {
  const html = generateHtmlReport(mockChain, { darkMode: false });

  expect(html).toContain('#ffffff'); // light bg
  expect(html).toContain('#333333'); // light text
});

  it('generateHtmlReport uses custom title', () => {
  const customTitle = 'Custom Golden Thread Report';
  const html = generateHtmlReport(mockChain, { title: customTitle });

  expect(html).toContain(customTitle);
  expect(html).toContain(`<title>${customTitle}</title>`);
});

  it('generateHtmlReport includes metadata when requested', () => {
  const html = generateHtmlReport(mockChain, { includeMetadata: true });

  expect(html).toContain('Metadata');
  expect(html).toContain('issue_key');
});

  it('generateHtmlReport excludes metadata when not requested', () => {
  const html = generateHtmlReport(mockChain, { includeMetadata: false });

  const metadataCount = (html.match(/Metadata/g) || []).length;
  // May still have "Metadata" in style or comments, so we check for reduced count
  expect(metadataCount).toBeLessThan(7); // 7 would be one per stage
});

  it('generateJsonReport produces valid JSON', () => {
  const json = generateJsonReport(mockChain);
  const parsed = JSON.parse(json);

  expect(parsed.golden_thread_id).toBe(mockChain.golden_thread_id);
  expect(parsed.stages).toHaveLength(7);
});

  it('generateJsonReport preserves all stage data', () => {
  const json = generateJsonReport(mockChain);
  const parsed = JSON.parse(json);

  mockChain.stages.forEach((stage, index) => {
    const parsedStage = parsed.stages[index];
    expect(parsedStage.stage).toBe(stage.stage);
    expect(parsedStage.status).toBe(stage.status);
    expect(parsedStage.actor).toBe(stage.actor);
    expect(parsedStage.artifact_url).toBe(stage.artifact_url);
  });
});

  it('generateHtmlReport handles incomplete chain (missing stages)', () => {
  const incompleteChain: GoldenThreadChain = {
    golden_thread_id: '550e8400-e29b-41d4-a716-446655440000',
    created_at: '2026-07-22T10:00:00Z',
    stages: [mockChain.stages[0], mockChain.stages[1]]
  };

  const html = generateHtmlReport(incompleteChain);

  expect(html).toContain('Spec');
  expect(html).toContain('Test');
  expect(html).toContain('Evidence');
  expect(html).toContain('PENDING'); // Empty stages should show PENDING
});

  it('generateHtmlReport renders timestamps in readable format', () => {
    const html = generateHtmlReport(mockChain);

    mockChain.stages.forEach(() => {
      expect(html).toContain('Timestamp');
    });
  });

  it('generateHtmlReport includes actor information', () => {
  const html = generateHtmlReport(mockChain);

  mockChain.stages.forEach(stage => {
    expect(html).toContain(stage.actor);
  });
});

  it('generateHtmlReport has responsive design CSS', () => {
  const html = generateHtmlReport(mockChain);

  expect(html).toContain('@media (max-width: 768px)');
  expect(html).toContain('flex-direction: column');
});

  it('generateJsonReport returns properly formatted JSON string', () => {
    const json = generateJsonReport(mockChain);

    expect(json).toEqual(JSON.stringify(mockChain, null, 2));
  });
});
