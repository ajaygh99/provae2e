# On-Demand Nightly Run Setup

## Disable Automatic 10 PM Run

**Windows Task Scheduler → Disable Schedule**

1. Press `Win + R`, type `taskschd.msc`, press Enter
2. Navigate: **Task Scheduler Library → Microsoft → Windows** (or search "PROVA" in the search box)
3. Find task: `PROVA Nightly Agent Run` (or similar name)
4. Right-click → **Disable**
   - This stops the automatic 10 PM trigger
   - Script file remains intact—just not auto-triggered

**Verify Disabled:**
```powershell
# PowerShell (Admin)
Get-ScheduledTask -TaskName "*PROVA*" | Select-Object -Property TaskName, State
# Should show: State = Disabled
```

---

## Run Nightly Script On-Demand

### Option A: Direct PowerShell (Quick)

```powershell
# Navigate to repo
cd C:\Users\ajjuk\Documents\Cowork\Provae2e

# Run the script
.\scripts\nightly-run.ps1
```

**Expected Output:**
- Picks oldest `agent-implement` Issue from GitHub
- Runs ARIA → FORGE → VERA → waits for LENS review
- Logs to `daily/YYYY-MM-DD-nightlyrun.log`
- Takes 5-20+ minutes depending on Issue complexity

### Option B: From Cowork (Recommended)

Create a simple PowerShell trigger script:

```powershell
# File: C:\Users\ajjuk\Documents\Cowork\Provae2e\scripts\trigger-nightly.ps1

param(
    [switch]$NoWait
)

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ScriptPath = Join-Path $RepoRoot "scripts\nightly-run.ps1"

Write-Host "🚀 Starting PROVA Nightly Run (on-demand)..."
Write-Host "Repo: $RepoRoot"
Write-Host "Log: $RepoRoot\daily\$(Get-Date -Format 'yyyy-MM-dd')-nightlyrun.log"
Write-Host ""

if ($NoWait) {
    # Run in background
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy Bypass", "-File `"$ScriptPath`"" -WindowStyle Minimized
    Write-Host "✅ Running in background. Check logs in 5-20 minutes."
} else {
    # Run in foreground (wait for completion)
    & $ScriptPath
}
```

---

## Cowork Skill: Trigger Nightly Run (Option C)

Ask me to create a Cowork skill named `trigger-nightly-run` that you can invoke anytime:

```
/trigger-nightly-run
```

The skill will:
1. Launch the PowerShell script
2. Stream the logs to Cowork
3. Notify you when done

---

## Verification Checklist

✅ **Before Running:**
- [ ] GitHub CLI (`gh`) installed and authenticated
- [ ] `ANTHROPIC_API_KEY` set as user environment variable (not in script)
- [ ] Claude Code CLI installed: `npx claude --version`
- [ ] Repo at `C:\Users\ajjuk\Documents\Cowork\Provae2e` synced to main

✅ **After Running:**
- [ ] Check log file: `daily/YYYY-MM-DD-nightlyrun.log`
- [ ] Verify PR created on GitHub
- [ ] LENS review passed (check Actions tab)
- [ ] No "FATAL" errors in log

---

## Rollback to Auto-Run

If you want to re-enable 10 PM automatic trigger:

```powershell
# PowerShell (Admin)
Enable-ScheduledTask -TaskName "PROVA Nightly Agent Run"
```

---

## Notes

- **10 PM run disabled** → only runs when you manually trigger
- **Same agents, same logic** → ARIA/FORGE/VERA/LENS all function identically
- **Multiple runs safe** → script has mutex lock (won't conflict if you run it twice)
- **Logs accumulate** → one log file per day in `daily/` folder

**Cost:** ~$0.50–$2 per run (Haiku model, ~5-10K tokens depending on Issue complexity)
