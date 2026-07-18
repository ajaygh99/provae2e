# PROVA — AI QE Automation Platform
> **Website:** provae2e.com


> What you design is exactly what gets built, exactly what gets tested, and exactly what ships.

[![npm](https://img.shields.io/npm/v/@provae2e/cli)](https://www.npmjs.com/package/@provae2e/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Install

```bash
npm install -g @provae2e/cli
```

## Quick Start

```bash
# Browser testing
qe-tool run --url https://yourapp.com --type browser

# API testing  
qe-tool run --url https://api.yourapp.com --type api

# Mobile browser (iPhone 14 emulation)
qe-tool run --url https://yourapp.com --type mobile --device iPhone14

# All three in parallel
qe-tool run --url https://yourapp.com --type all --workers 5 --report

# With local AI summaries (requires Ollama)
qe-tool run --url https://yourapp.com --ai
```

## GitHub Actions (drop-in)

Copy `.github/workflows/prova-ci.yml` to your repository. Done.

## Autonomous Development

This repository is managed by the PROVA Trinity system:
- **Cowork** — Sprint planning, coordination, release announcements
- **Claude Code** — Feature implementation, testing, npm publishing  
- **GHE** — Source of truth, CI/CD, event bus

To request a feature: create a GHE Issue and add label `agent-implement`.
See `docs/SETUP.md` for the complete setup guide.

## Architecture

See `docs/ARCHITECTURE.md` for the full system design.

## License

MIT © PROVA
