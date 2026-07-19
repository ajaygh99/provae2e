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
ollama pull qwen3:8b       # VERA — test writer
ollama pull llama3.1:8b    # ARIA + LENS + SHIP

# Verify Ollama works
ollama list
```

### Clone this repo and install
```bash
git clone https://github.com/ajaygh99/provae2e.git
cd provae2e
npm install
npm run typecheck  # should pass with no errors
```

## Step 2 — GitHub Setup (5 minutes)

### Authenticate GitHub CLI
```bash
# Install GitHub CLI (winget install GitHub.cli), then:
gh auth login
# Complete browser OAuth flow, choose github.com
gh repo view ajaygh99/provae2e  # verify it works
```

### Connect the Claude GitHub App
1. In a terminal inside the repo folder, run: `claude` then `/install-github-app`
2. Follow the interactive prompts — it installs the Claude GitHub App on `ajaygh99/provae2e` and offers to add the GitHub Actions workflow + `ANTHROPIC_API_KEY` secret
3. If `/install-github-app` isn't available, install manually: visit https://github.com/apps/claude, click Install, select `ajaygh99/provae2e`

## Step 3 — Claude Code CLI (local, 10 minutes)
ARIA, FORGE, and VERA run locally now — not as cloud Routines — so they can
finish in minutes instead of hours and use full Claude-quality code gen. Cost
is per-token on the Claude API (roughly $30-100 for the whole MVP), paid for
by an API key, not a subscription.

```powershell
npm install -g @anthropic-ai/claude-code
claude --version
```

Get an API key from console.anthropic.com (Anthropic Console → API Keys),
then set it as a permanent user environment variable so both interactive
and scheduled (Task Scheduler) runs can see it:
```powershell
setx ANTHROPIC_API_KEY "sk-ant-api03-..."
# Close and reopen PowerShell for it to take effect
$env:ANTHROPIC_API_KEY   # should print your key
```

Verify Claude Code can run headless (no browser prompt):
```powershell
claude -p "Say OK" --model claude-haiku-4-5-20251001
```

## Step 4 — Local Nightly Automation (Task Scheduler, 5 minutes)
`scripts/nightly-run.ps1` is already in this repo. It finds the oldest open
Issue labeled `agent-implement`, runs ARIA+FORGE+VERA as one Claude Code CLI
session (Sonnet) to plan/implement/test/PR it, then kicks off LENS review.

Register it to run nightly at 10 PM:
```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"C:\Users\ajjuk\Documents\Cowork\Provae2e\scripts\nightly-run.ps1`""
$trigger = New-ScheduledTaskTrigger -Daily -At 10:00PM
Register-ScheduledTask -TaskName "PROVA-NightlyAgentRun" -Action $action -Trigger $trigger -Description "ARIA+FORGE+VERA nightly implementation pass"
```

Test it manually before trusting it overnight:
```powershell
Start-ScheduledTask -TaskName "PROVA-NightlyAgentRun"
# Watch progress:
Get-Content "C:\Users\ajjuk\Documents\Cowork\Provae2e\daily\$(Get-Date -Format yyyy-MM-dd)-nightlyrun.log" -Wait
```

## Step 5 — GitHub Repo Secrets (2 minutes)
Add these at github.com/ajaygh99/provae2e → Settings → Secrets and variables → Actions.
Only LENS (GitHub Actions) and SHIP need secrets — ARIA/FORGE/VERA read the
key from your local machine's environment variable, not from GitHub.
```
ANTHROPIC_API_KEY = sk-ant-api03-...  (same key as Step 3, powers LENS's review)
NPM_TOKEN          = npm_...           (from npmjs.com, for SHIP's npm publish)
GH_PAT             = ghp_...           (GitHub PAT, for SHIP to push the version bump)
```

## Step 6 — Cowork Setup (10 minutes)
1. Open Claude desktop app → Cowork tab
2. Point Cowork at this project folder (grant read/write)
3. Settings → Connectors → Add Custom Connector
4. Add Composio MCP: npx @composio/mcp@latest setup [your-url] --client claude
5. Authenticate Composio with your GitHub credentials
6. Install the 5 Skills from .claude/skills/ folder
7. Schedule the standup skill: daily 08:30
8. Schedule the sprint-planner skill: bi-weekly Monday 08:00
9. Schedule the delegate-to-agents skill: daily 09:00

## Step 7 — First Issue (the moment it all starts)
Create an Issue on GitHub:
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
