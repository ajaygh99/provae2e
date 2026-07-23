Issue: #106 — Golden Thread: Tests & Validation
Branch: feature/issue-106-golden-thread-tests

Files to create:
- tests/golden-thread/fixtures/golden-thread-fixtures.ts (shared mock payloads + builders)

Files to study first:
- src/core/golden-thread-store.ts, golden-thread-linker.ts
- src/core/golden-thread-jira.ts, golden-thread-github.ts, golden-thread-datadog.ts
- src/core/github-api-client.ts, jira-connector.ts (mock surfaces)
- src/queries/trace-query.ts

Function signatures:
- createGitHubClientStub(overrides?) => GitHubClientStub
- linkTestAndEvidenceStages(linker, id) => Promise<void>
- buildPartialChain(linker, upToStage) => Promise<string>
- Exported mock constants: MOCK_JIRA_SUCCESS/FAILURE, MOCK_COMMIT, MOCK_WORKFLOW_RUN, MOCK_DEPLOYMENTS

Acceptance criteria: mock payloads type-match the real GitHub/JIRA types (zero `any`).
Done when: TypeScript compiles, ESLint passes, VERA suites green.

FORGE: Done. Files: tests/golden-thread/fixtures/golden-thread-fixtures.ts. No production code changed —
this issue is test-only; the framework under test already ships.
