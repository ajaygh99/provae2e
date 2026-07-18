# Release Announce Skill
# Cowork runs this when a GitHub Release is created on GHE

## Trigger
- Event: GitHub Release published (via Composio webhook)

## Steps
1. Read the release via Composio GitHub MCP:
   - Version number, release notes, PR list, date
2. Read `sprint/current-sprint.md` for sprint goals context
3. Write release announcement (customer-friendly, no jargon):
   ```
   🚀 PROVA v1.x.x is live!

   What's new:
   • [Feature A] — [plain English benefit]
   • [Feature B] — [plain English benefit]
   • [Bug fix] — [what was fixed]

   Install/update: npm install -g @provae2e/cli
   Docs: [link]
   ```
4. Post announcement to:
   - Slack #prova-releases
   - Discord #releases (if channel exists)
5. Update `releases/v1.x.x-announcement.md` in the repo
6. Start next sprint planning cycle: write next Monday's agenda

## Tone
- Friendly, direct, no marketing fluff
- Focus on what the user can now DO, not what was coded
- Maximum 3 bullet points in public announcement
