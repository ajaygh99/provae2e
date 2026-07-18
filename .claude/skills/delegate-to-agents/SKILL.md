# Delegate to Agents Skill
# Cowork runs this every weekday at 09:00 and on-label webhook

## Trigger
- Schedule: Daily 09:00
- Event: GHE Issue labeled `agent-implement` (via Composio webhook)

## Steps
1. Read all Issues labeled `agent-implement` via Composio GitHub MCP
2. For each Issue NOT yet labeled `in-progress`:
   a. Add label `in-progress` to the Issue
   b. Fire ARIA Routine via HTTP POST:
      ```
      POST https://api.anthropic.com/v1/claude_code/routines/[ARIA_TRIGGER_ID]/fire
      Authorization: Bearer [ARIA_ROUTINE_TOKEN]
      anthropic-beta: experimental-cc-routine-2026-04-01
      {"text": "Implement Issue #N: [title]. [Issue URL]. Read CLAUDE.md and AGENTS.md. Plan, delegate FORGE+VERA, open PR."}
      ```
   c. Post comment on Issue: "🤖 ARIA assigned. Implementation started."
   d. Log to `sprint/agent-tasks.md`: Issue #N delegated at [timestamp]
3. If Routines daily cap (15) reached: batch remaining Issues into one run
   - Write all pending Issues to `sprint/agent-tasks.md` as a queue
   - ARIA reads the queue file and processes sequentially

## Important
- Store ARIA_ROUTINE_TOKEN in Cowork's secure credential store
- Never write the token to any file or log
- If Routine fire fails (HTTP != 200): retry once after 5 min, then alert Slack
