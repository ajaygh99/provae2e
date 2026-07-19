# PROVA — AI QE Automation Platform
> **Website:** provae2e.com


> What you design is exactly what gets built, exactly what gets tested, and exactly what ships.

[![npm](https://img.shields.io/npm/v/@provae2e/cli)](https://www.npmjs.com/package/@provae2e/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Install

```bash
npm install -g @provae2e/cli
npx playwright install chromium
```

The second command installs the Chromium runtime used by browser and mobile tests.

## Quick Start

```bash
# Browser testing (headless Chromium)
qe-tool run --url https://yourapp.com --type browser

# API testing  
qe-tool run --url https://api.yourapp.com --type api

# Mobile browser (iPhone 14 emulation)
qe-tool run --url https://yourapp.com --type mobile --device iPhone14

# Browser, API, and mobile testing in one command
qe-tool run --url https://yourapp.com --type all --report

# With local AI summaries (requires Ollama)
qe-tool run --url https://yourapp.com --ai
```

## Browser Testing (`--type browser`)

Launches headless Playwright to test web applications.

**Features:**
- Headless Chromium
- Automatic page load assertion
- Screenshot capture (default: `./screenshots/`)
- Structured result output: `{ status, title, durationMs, screenshotPath, error }`

**Usage:**
```bash
qe-tool run --url https://yourapp.com --type browser [options]
```

**Exit code:** `0` on PASS, `1` on FAIL (useful for CI/CD detection)

## Mobile Browser Testing (`--type mobile`)

Runs the same headless Playwright flow as `--type browser`, but under emulation of a mobile device (viewport, user agent, touch, device scale factor).

**Features:**
- Device emulation via Playwright's `devices` descriptors
- Automatic page load assertion
- Screenshot capture (default: `./screenshots/`)
- Structured result output: `{ status, device, title, durationMs, screenshotPath, error }`

**Usage:**
```bash
qe-tool run --url https://yourapp.com --type mobile --device iPhone14 [options]
```

**Supported `--device` values:**
| Alias | Emulates |
|-------|----------|
| `iPhone14` | iPhone 14 |
| `iPhoneSE` | iPhone SE |
| `Pixel7` | Pixel 7 |
| `GalaxyS21` | Galaxy S24 (nearest available Samsung device — Playwright dropped the exact S21 profile) |
| `iPad` | iPad (gen 7) |

Exact Playwright device keys (e.g. `"iPhone 14 Pro"`) are also accepted. More devices will follow in a later Issue.

**Exit code:** `0` on PASS, `1` on FAIL (useful for CI/CD detection)

## API Testing (`--type api`)

Sends REST or GraphQL requests via Playwright's `APIRequestContext` — no separate HTTP client.

**Features:**
- REST: GET, POST, PUT, DELETE
- GraphQL: query/mutation via `--graphql`
- Assertions: status code, response time, optional response schema
- Structured result output: `{ status, statusCode, durationMs, responseSummary, error }`

**Usage:**
```bash
qe-tool run --url https://api.yourapp.com --type api [options]

# REST POST with a JSON body, expecting a 201
qe-tool run --url https://api.yourapp.com/posts --type api \
  --method POST --body '{"title":"foo"}' --expect-status 201

# GraphQL query (--body becomes the GraphQL variables)
qe-tool run --url https://api.yourapp.com/graphql --type api \
  --graphql 'query($id: ID!) { user(id: $id) { id name } }' --body '{"id":"1"}'
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--method <method>` | REST method: GET\|POST\|PUT\|DELETE | `GET` |
| `--body <json>` | JSON request body (REST) or GraphQL variables | — |
| `--graphql <query>` | GraphQL query/mutation document — switches the request to GraphQL | — |
| `--expect-status <code>` | Expected HTTP status code | `200` |

**Exit code:** `0` on PASS, `1` on FAIL (useful for CI/CD detection)

## HTML Report (`--report`)

Add `--report` to any run (`--type browser|api|mobile|all`) to generate an Allure-style static HTML report — no server required, opens straight from disk.

**Features:**
- Pass/fail counts and duration per test case
- Failure screenshots linked from browser/mobile results
- Trend chart across past runs (history persisted alongside the report)

**Usage:**
```bash
qe-tool run --url https://yourapp.com --type browser --report
```

Writes `./allure-report/index.html` (open directly in a browser) and `./allure-report/history.json` (run history powering the trend).

## GitHub Actions (drop-in)

Copy [`templates/github-actions/qe-tool-ci.yml`](templates/github-actions/qe-tool-ci.yml) into your own repository's `.github/workflows/` folder. Done.

The template installs `@provae2e/cli`, runs `qe-tool run --type all --report` against a URL you provide, and uploads the resulting Allure report as a build artifact.

**Usage:**
1. Copy the file to `.github/workflows/qe-tool-ci.yml` in your repo.
2. Push it, then go to your repo's **Actions** tab → **PROVA QE Suite** → **Run workflow**.
3. Enter the `url` input (the target to test) and run it.
4. When it finishes, download the `prova-allure-report` artifact from the run summary and open `index.html`.

Add your own `push`/`pull_request`/`schedule` triggers alongside `workflow_dispatch` in the copied file if you want it to run automatically instead of on demand.

## Autonomous Development

This repository is managed by the PROVA Trinity system:
- **Cowork** — Sprint planning, coordination, release announcements
- **Claude Code** — Feature implementation, testing, npm publishing  
- **GitHub** — Source of truth, CI/CD, event bus

To request a feature: create a GitHub Issue and add label `agent-implement`.
See `docs/SETUP.md` for the complete setup guide.

## Architecture

See `docs/ARCHITECTURE.md` for the full system design.

## License

MIT © PROVA
