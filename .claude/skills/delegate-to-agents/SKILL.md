# Delegate to Agents Skill
# Cowork runs this every weekday at 09:00.
#
# ARIA/FORGE/VERA no longer run as cloud Routines — they run locally at
# 10 PM via Windows Task Scheduler + scripts/nightly-run.ps1 (see CLAUDE.md
# "Execution Model"). This skill's job during the day is just to queue and
# confirm work for that night's run, not to trigger anything itself.

## Trigger
- Schedule: Daily 09:00

## Steps
1. Read all open Issues labeled `agent-implement` via Composio GitHub MCP
2. For each Issue NOT yet noted in `sprint/agent-tasks.md`:
   a. Append it to `sprint/agent-tasks.md` under "Pending Tasks" (this is the
      queue `nightly-run.ps1` reads from — it always picks the oldest one)
   b. Post comment on the Issue: "🤖 Queued for tonight's automated run (10 PM)."
3. Read `daily/YYYY-MM-DD-nightlyrun.log` (last night's log, if present) and
   fold a one-line summary into today's standup context — this is how Ajay
   finds out what actually happened overnight without opening the terminal.

## Important
- This skill never calls the Claude API directly and never touches secrets —
  it only reads/writes GitHub Issues and local markdown files.
- If more than 4 Issues are queued at once, leave them all in the queue —
  `nightly-run.ps1` processes one per night, oldest first.
