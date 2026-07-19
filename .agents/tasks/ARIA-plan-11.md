# ARIA Plan — Issue #11: GitHub Actions drop-in config for end users

## Issue summary
End users of the published `@provae2e/cli` npm package need a ready-to-use
GitHub Actions workflow they can copy into their own repo's
`.github/workflows/` folder. It should install `@provae2e/cli`, run
`qe-tool run --type all --report` against a configurable URL input, and
upload the generated Allure report as a build artifact. README needs a
section explaining how to use it. A test parses the YAML and asserts it's
structurally valid.

## Current architecture notes
- This repo already has two workflow files, both internal and NOT the
  target of this issue: `.github/workflows/prova-ci.yml` (this repo's own
  CI: typecheck/test-matrix/ship/smoke) and `agent-trigger.yml` (LENS
  review). Neither gets modified.
- README.md already has a `## GitHub Actions (drop-in)` section
  (line 129) that currently (incorrectly, pre-#11) tells users to copy
  `prova-ci.yml` — that file assumes it's running inside the PROVA repo
  itself (npm ci against this repo's own package.json, SHIP publish step,
  etc.) and is unusable as-is by an end user's repo. This section gets
  rewritten to point at the new template instead.
- `qe-tool run --type all` is accepted by the CLI's Commander option
  parser (`src/cli/run.ts`) today but falls through to a not-yet-implemented
  branch that just logs and exits 0 — that's a pre-existing gap out of
  scope for #11 (the issue only asks for the template file + README + test,
  not for finishing the `all` runner). The template still uses
  `--type all --report` per the issue's acceptance criteria; it's what an
  end user should run once `all` ships.
- `js-yaml` (v4.3.0) is already present in `node_modules` (transitive dep),
  so no new dependency needs adding for the test. The project's own `yaml`
  package (a direct dependency used in `src/`) is a different library —
  the issue explicitly asks for `js-yaml` in the test, so devDependencies
  gets `js-yaml` + `@types/js-yaml` added explicitly rather than relying on
  the transitive install.
- Tests live under `tests/<domain>/*.test.ts`, matching the issue's own
  suggested path `tests/templates/github-actions.test.ts`.

## Files to create
- `templates/github-actions/qe-tool-ci.yml` — minimal, well-commented
  workflow:
  - `workflow_dispatch` trigger with a required `url` input (configurable
    target URL), default `https://example.com`.
  - Job steps: checkout, setup-node@20, `npm install -g @provae2e/cli`,
    `npx playwright install --with-deps chromium webkit firefox` (GitHub-
    hosted runners don't ship Playwright browser binaries), run
    `qe-tool run --url "${{ inputs.url }}" --type all --report`, then
    `actions/upload-artifact@v4` (`if: always()`) uploading `allure-report/`.
  - Follows the comment style and action versions (`@v4`) already used in
    `prova-ci.yml`.
- `tests/templates/github-actions.test.ts` — reads the template file,
  parses it with `js-yaml`, and asserts: valid YAML syntax (parses without
  throwing), has a top-level `on` key with `workflow_dispatch.inputs.url`,
  has a top-level `jobs` key with at least one job, that job's steps
  include an `npm install -g @provae2e/cli` run step, a `qe-tool run`
  step referencing `--type all` and `--report`, and an
  `actions/upload-artifact` step. 80%+ coverage isn't meaningful for a
  static template file with no src/ logic — the test itself is the
  coverage requirement here (per the issue's own "Tests:" line).

## Files to modify
- `README.md` — rewrite the `## GitHub Actions (drop-in)` section (line
  129) to reference `templates/github-actions/qe-tool-ci.yml` instead of
  `prova-ci.yml`, with copy instructions and a note on the `url` input.
- `package.json` — add `js-yaml` + `@types/js-yaml` to `devDependencies`.

## Done when
- `npx tsc --noEmit` — zero errors.
- `npm run lint` — zero warnings.
- `npm test` — all green including the new template test.
- `qa/run-results.md` updated.
- Branch `feature/issue-11` pushed, PR opened against `main` referencing
  `Closes #11`.
