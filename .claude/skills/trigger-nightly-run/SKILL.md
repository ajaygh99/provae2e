# Trigger Nightly Run On-Demand

**Trigger:** `trigger nightly run` or `run agents now` or `kick off nightly`

## What This Does
Launches the PROVA agent pipeline (ARIA → FORGE → VERA → LENS) immediately without waiting for 10 PM.

## How to Use (Examples)
- "trigger nightly run"
- "run the nightly pipeline"
- "kick off issue #42 implementation"
- "start agents now"

## Output
- PowerShell script starts in background
- Real-time log stream to Cowork
- Completion notification with PR link
- Time estimate: 5-20 minutes

## Requirements
✅ Windows Task Scheduler task disabled (see NIGHTLY-RUN-SETUP.md)
✅ GitHub CLI authenticated
✅ ANTHROPIC_API_KEY set
✅ Claude Code CLI installed

## Behind the Scenes
Executes: `.\scripts\nightly-run.ps1` from repo root
Logs to: `daily/YYYY-MM-DD-nightlyrun.log`

---

**Step 1: Ask me to trigger the run**

"@Claude trigger the nightly run now"

**Step 2: I'll execute the script**

The script will:
- Pick oldest Issue labeled `agent-implement`
- Run ARIA (planner) → FORGE (coder) → VERA (tester)
- Wait for LENS (code review) to pass
- Auto-merge if LENS approves

**Step 3: Monitor the logs**

Check `daily/` folder or I'll stream updates here.

---

No waiting for 10 PM. No scheduler. Just ask.
