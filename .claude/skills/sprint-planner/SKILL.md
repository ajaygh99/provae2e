# Sprint Planner Skill
# Cowork runs this every Monday 08:00 to plan the bi-weekly sprint

## Trigger
Schedule: Every other Monday at 08:00 (bi-weekly)

## Steps
1. Read all open GHE Issues via Composio GitHub MCP
   - Filter: not labeled `in-progress`, not labeled `blocked`
   - Sort by: customer-reported bugs first, then features, then improvements
2. Read `feedback/` folder for latest customer requests
3. Read `qa/run-results.md` for any outstanding quality issues
4. Prioritise: max 4 Issues per sprint for agent implementation
5. Write `sprint/current-sprint.md` with:
   - Sprint number and dates
   - 4 selected Issues with rationale
   - Definition of done for each
   - Agent assignments (ARIA handles all via delegation)
6. Write `sprint/agent-tasks.md` with task queue for ARIA
7. Add label `sprint-current` to selected GHE Issues
8. Post sprint plan to Slack #prova-team channel
9. Post summary to `daily/YYYY-MM-DD-standup.md`

## Output Format for current-sprint.md
```
# Sprint N — YYYY-MM-DD to YYYY-MM-DD

## Goals
[2-3 sentence sprint objective]

## Issues This Sprint
| Issue | Title | Priority | Agent |
|-------|-------|----------|-------|
| #N    | ...   | P1       | ARIA  |

## Definition of Done
- All tests pass (browser + API + mobile)
- LENS review: no BLOCKER or MAJOR items
- Ajay reviewed and approved PR
- npm published successfully
```
