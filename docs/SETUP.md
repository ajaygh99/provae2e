# PROVA Bootstrap Setup
# One-time setup. Do this BEFORE adding label to any Issues.

## Step 1 — Local Machine (20 minutes)

### Install tools
```bash
# Node.js 20+
node --version  # should be v20+

# Ollama (local AI — $0 per inference)
curl -fsSL https://ollama.com/install.sh | sh

# Pull all agent models (one-time, ~17GB)
ollama pull qwen3:14b      # FORGE — best local coder
ollama pull qwen3:7b       # VERA — test writer
ollama pull llama3.1:8b    # ARIA + LENS + SHIP

# Verify Ollama works
ollama list
```

### Clone this repo and install
```bash
git clone https://github.yourcompany.com/org/provae2e.git
cd prova
npm install
npm run typecheck  # should pass with no errors
```

## Step 2 — GHE Setup (5 minutes)

### Authenticate Claude Code to GHE
```bash
# Install GitHub CLI
gh auth login --hostname github.yourcompany.com
# Complete browser OAuth flow
gh repo list  # verify it works
```

### Connect GHES to Claude Code (Admin does once)
1. Go to claude.ai/admin-settings/claude-code
2. Click "Connect GitHub Enterprise Server"
3. Enter hostname: github.yourcompany.com
4. Install the Claude GitHub App on your GHE instance
5. Add this repo to allowed repositories

## Step 3 — Claude Code Routines (10 minutes)
Go to claude.ai/code/routines and create 5 Routines:

### Routine 1: ARIA — Issue Implementer
- Prompt: "You are ARIA. Read CLAUDE.md and .agents/AGENTS.md. Read the Issue described in the trigger text. Create an implementation plan in .agents/tasks/ARIA-plan-N.md. Delegate to FORGE and VERA by writing task files. Create a feature branch via gh CLI. Comment on the Issue."
- Repository: org/provae2e
- Trigger: API (copy the trigger ID → ARIA_ROUTINE_TRIGGER_ID secret)

### Routine 2: VERA — Test Rerunner  
- Prompt: "You are VERA. Read CLAUDE.md and .agents/AGENTS.md. Run npm test. If failing, write bug report to .agents/bugs/. If passing, update qa/run-results.md."
- Trigger: API (copy → VERA_ROUTINE_TRIGGER_ID secret)

### Routine 3: SHIP — Releaser
- Prompt: "You are SHIP. Check releases/ folder for approval doc. If found, run: npm version patch, npm publish, create git tag, create GitHub Release, update CHANGELOG.md."
- Trigger: GitHub event (PR merged to main)

### Routine 4: LENS — Reviewer
- Prompt: "You are LENS. Review the PR diff against AGENTS.md checklist. Post inline review comments on the PR. Flag BLOCKERs, MAJORs, MINORs."
- Trigger: GitHub event (PR opened)

### Routine 5: ARIA-Daily — Task Processor
- Prompt: "You are ARIA. Read sprint/agent-tasks.md. Process any pending tasks by creating feature branches and delegating to FORGE+VERA. Update the task queue file."
- Trigger: Schedule (daily 09:00)

## Step 4 — GHE Secrets (2 minutes)
Add these to your GHE repo Settings → Secrets:
```
ARIA_ROUTINE_TRIGGER_ID   = trig_01... (from Step 3)
ARIA_ROUTINE_TOKEN        = sk-ant-oat01-... (from Step 3)
VERA_ROUTINE_TRIGGER_ID   = trig_01...
VERA_ROUTINE_TOKEN        = sk-ant-oat01-...
NPM_TOKEN                 = npm_... (from npmjs.com)
GH_PAT                    = ghp_... (GitHub PAT for SHIP to push)
```

## Step 5 — Cowork Setup (10 minutes)
1. Open Claude desktop app → Cowork tab
2. Point Cowork at this project folder (grant read/write)
3. Settings → Connectors → Add Custom Connector
4. Add Composio MCP: npx @composio/mcp@latest setup [your-url] --client claude
5. Authenticate Composio with your GHE credentials
6. Install the 5 Skills from .claude/skills/ folder
7. Schedule the standup skill: daily 08:30
8. Schedule the sprint-planner skill: bi-weekly Monday 08:00
9. Schedule the delegate-to-agents skill: daily 09:00

## Step 6 — First Issue (the moment it all starts)
Create an Issue on GHE:
```
Title: [FEATURE] Implement browser runner — Playwright headless
Body:
  Acceptance Criteria:
  - qe-tool run --url https://example.com runs Playwright headless
  - Visits the URL, takes screenshot, asserts page title
  - Output: PASS/FAIL + duration + screenshot path
  - Tests: src/runners/browser-runner.test.ts (80%+ coverage)
  
  Technical context:
  - Use Playwright Test (@playwright/test)
  - Entry: src/runners/browser-runner.ts
  - Wire into src/cli/run.ts --type browser
  - Follow patterns in src/core/logger.ts
```
Add label: `agent-implement`

**The system takes over from here.**
