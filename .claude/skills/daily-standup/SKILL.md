# Daily Standup Skill
# Cowork runs this every weekday at 08:30

## Trigger
Schedule: Every weekday at 08:30

## Steps
1. Read GitHub via Composio:
   - PRs opened since yesterday
   - PRs merged since yesterday
   - Issues labeled `agent-implement` (in queue)
   - Issues labeled `in-progress` (being worked on)
   - Failed GitHub Actions runs
2. Read `.agents/bugs/` for any new bug reports from VERA
3. Read `qa/run-results.md` for test status
4. Write standup to `daily/YYYY-MM-DD-standup.md`:
   - Done yesterday: merged PRs
   - In progress today: active Issues with agents
   - Blocked: any BLOCKER items from LENS or VERA bugs
   - Next: Issues in queue
5. Post standup summary to Slack #prova-standup (3 bullets max)
6. If any BLOCKER found: tag @Ajay in Slack immediately

## Standup Format
```
# PROVA Standup — YYYY-MM-DD

## ✅ Done Yesterday
- PR #N merged: [title] (SHIP: v1.x.x published)

## 🔄 In Progress
- Issue #N: [title] — FORGE implementing, VERA writing tests

## ⚠️ Blockers
- None | [describe blocker and who needs to act]

## 📋 Queue
- Issue #N: [title] — waiting for agent-implement label
```
