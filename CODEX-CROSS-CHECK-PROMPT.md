# 🤖 CODEX AUTONOMOUS FIX PROMPT
## Cross-Check & Fix All Independent Review Issues

**Source:** Independent Review Report (July 25, 2026)
**Target:** ARIA, FORGE, VERA, LENS agents
**Objective:** Verify all findings and fix all blockers
**Success Criteria:** 100% test pass, zero blocking issues

---

## 🎯 MISSION BRIEF

An independent reviewer found **3 critical blockers** preventing PROVA v0.3.0 Beta launch:

1. **Studio TypeScript compilation errors** (5+ errors)
2. **Promotion integration test failures** (41 tests)
3. **Browser/mobile setup documentation missing**

**Plus:** 32 security vulnerabilities in dev dependencies

**Your task:**
- Independently verify each finding
- Execute fixes with full test validation
- Document root causes
- Confirm production readiness

---

## 📋 PHASE 1: ARIA — VERIFICATION & PLANNING

### Task 1.1: Verify Studio TypeScript Errors

**Execute:**
```bash
cd studio
npm ci
npm run typecheck 2>&1 | tee studio-typecheck-results.log
npm run lint 2>&1 | tee studio-lint-results.log
```

**Verify Finding:**
- [ ] Can you reproduce 5+ TypeScript errors?
- [ ] Error messages match review findings?
- [ ] Missing type definitions confirmed?
- [ ] Location: studio/tsconfig.json

**Report:**
- If errors exist: Document exact errors, create ISSUE-ts-errors.md
- If no errors: Document why (cached dependencies, version changes)
- Create `.agents/tasks/ARIA-verify-studio-errors.md` with findings

---

### Task 1.2: Verify Promotion Test Failures

**Execute:**
```bash
npm run test:ci -- --testPathPattern=promotion 2>&1 | tee promotion-test-results.log
npm run test:ci 2>&1 | tail -100 > full-test-results.log
```

**Verify Finding:**
- [ ] Count actual failing tests (review claimed 41)
- [ ] Identify failure patterns (env-chain, status validation?)
- [ ] Which specific tests fail? (exact file:line)
- [ ] Root cause analysis: is it logic or environment?

**Report:**
- Create `.agents/bugs/ISSUE-promotion-failures.md` with:
  - Exact test names
  - Error messages
  - Stack traces
  - Hypothesis on root cause

---

### Task 1.3: Verify Browser/Mobile Setup Issues

**Execute:**
```bash
npm run test:smoke 2>&1 | tee smoke-test-results.log
grep -r "playwright install" README.md || echo "Not found"
grep -r "Troubleshooting" README.md || echo "Not found"
```

**Verify Finding:**
- [ ] Do smoke tests fail due to missing Playwright binaries?
- [ ] Is setup documentation missing from README?
- [ ] Are there error messages users would see?

**Report:**
- Create `.agents/tasks/ARIA-verify-browser-setup.md` with findings

---

### Task 1.4: Verify Security Vulnerabilities

**Execute:**
```bash
npm audit --json > npm-audit-results.json
npm audit 2>&1 | tee npm-audit-report.log
echo "=== Dev Dependency Analysis ==="
npm ls jest ts-jest babel-jest 2>&1 | head -50
```

**Verify Finding:**
- [ ] Count high-severity vulnerabilities (review claimed 32)
- [ ] Are they in dev or production dependencies?
- [ ] What's the vulnerability chain?
- [ ] Are production dependencies safe?

**Report:**
- Create `.agents/tasks/ARIA-verify-security.md` with findings

---

### ARIA Decision Point

**If All Findings Verified:** ✅ Proceed to PHASE 2 (FORGE & VERA)
**If Findings Differ:** ❌ Stop and create detailed report of discrepancies

**Create:** `.agents/tasks/ARIA-CROSS-CHECK-REPORT.md`
```markdown
## ARIA Cross-Check Report
Date: [timestamp]

### Studio TypeScript Errors
- Status: [VERIFIED / NOT FOUND / DIFFERENT]
- Details: [exact errors found]

### Promotion Test Failures
- Status: [VERIFIED / NOT FOUND / DIFFERENT]
- Count: [actual number]
- Root Cause: [analysis]

### Browser/Mobile Setup
- Status: [VERIFIED / NOT FOUND / DIFFERENT]
- Documentation Gap: [specific sections missing]

### Security Vulnerabilities
- Status: [VERIFIED / NOT FOUND / DIFFERENT]
- Count: [actual number]
- Risk Level: [production impact]

## Recommendation
[Proceed to fixes / Investigate discrepancies / Other]
```

---

## 🔧 PHASE 2: FORGE — FIX BLOCKERS

### Only Proceed If ARIA Verified Issues

---

### Fix 1: Studio TypeScript Errors

**Owner:** FORGE
**Time Budget:** 60 minutes
**Success Criteria:** `npm run typecheck` = 0 errors

**Steps:**

```bash
# Step 1: Diagnose
cd studio
npm ci --force
npm run typecheck 2>&1 | head -50 > /tmp/ts-errors.txt

# Step 2: Identify root cause
# Check tsconfig.json for type library entries
cat studio/tsconfig.json | grep -A5 "types"

# Step 3: Fix (one of these approaches)
# Approach A: Remove problematic type libraries from tsconfig
# Approach B: Install missing type definitions
# Approach C: Update tsconfig to match installed packages

# Step 4: Validate
npm run typecheck
npm run build
npm run test
```

**If Issue is Missing Type Definitions:**
```bash
cd studio
npm install --save-dev @types/vitest vitest
npm install --save-dev @testing-library/jest-dom
npm run typecheck
```

**If Issue is tsconfig Mismatch:**
- Review studio/tsconfig.json "types" array
- Remove entries for uninstalled packages
- Run `npm run typecheck` again

**If Issue is Build Config:**
- Check vite.config.ts
- Check .storybook/main.ts
- Ensure all imports are resolvable

**Create Issue:** `.agents/tasks/FORGE-studio-fix-[hash].md`
```markdown
## Studio TypeScript Fix

### Error Found
[exact error]

### Root Cause
[analysis]

### Fix Applied
[what was changed]

### Validation
- npm run typecheck: [result]
- npm run build: [result]
- npm run test: [result]

### Status: [FIXED / PARTIAL / FAILED]
```

---

### Fix 2: Promotion Integration Test Failures

**Owner:** FORGE
**Time Budget:** 120 minutes
**Success Criteria:** All promotion tests pass (0 failures)

**Steps:**

```bash
# Step 1: Isolate failures
npm run test:ci -- --testPathPattern=promotion --verbose 2>&1 | tee promotion-debug.log

# Step 2: Analyze failure patterns
grep "Expected\|Received\|Error" promotion-debug.log

# Step 3: Identify suspect code
# Files to examine:
# - src/promotions/env-chain-manager.ts
# - src/promotions/promotion-reporter.ts
# - src/promotions/env-config-loader.ts
# - tests/promotions/promotion-integration.test.ts

# Step 4: Debug env-chain-manager
# Common issues:
# - Environment variable precedence
# - Async/await timing issues
# - State management between tests
# - Mock data setup

# Step 5: Add debug logging
# Modify env-chain-manager.ts to log:
# - Input environment variables
# - Processing steps
# - Final output state

npm run test:ci -- --testPathPattern=promotion --verbose 2>&1 | tail -100
```

**Debugging Checklist:**
- [ ] Are environment variables being loaded correctly?
- [ ] Is state persisting between test runs?
- [ ] Are mocks set up correctly?
- [ ] Is timing/async handling correct?
- [ ] Are the success criteria clear?

**If Root Cause is Logic Bug:**
```typescript
// Check env-chain-manager.ts for:
// 1. Correct variable precedence (CLI > ENV > config)
// 2. Proper async/await handling
// 3. State isolation between runs
// 4. Correct return value types
```

**If Root Cause is Test Setup:**
```typescript
// Check promotion-integration.test.ts for:
// 1. Proper beforeEach/afterEach cleanup
// 2. Mock environment setup
// 3. Correct assertions
// 4. Test data validity
```

**Create Issue:** `.agents/tasks/FORGE-promotion-fix-[hash].md`
```markdown
## Promotion Test Fix

### Failures Found
[number of failures]
[specific test names]

### Root Cause Analysis
[what was wrong]

### Fix Applied
[code changes]

### Testing
- Before fix: [X failures]
- After fix: [0 failures]
- Coverage maintained: [yes/no]

### Status: [FIXED / PARTIAL / FAILED]
```

---

### Fix 3: Browser/Mobile Setup Documentation

**Owner:** FORGE
**Time Budget:** 45 minutes
**Success Criteria:** README has troubleshooting section

**Steps:**

```bash
# Step 1: Add troubleshooting section to README.md
cat >> README.md << 'EOF'

## Troubleshooting

### Playwright Browser Installation

If you see this error:
\`\`\`
browserType.launch: Executable doesn't exist at
  /path/to/ms-playwright/chromium_headless_shell-1228/...
\`\`\`

**Solution:** Install Playwright browsers
\`\`\`bash
npx playwright install chromium firefox webkit
\`\`\`

### Platform-Specific Setup

#### macOS
\`\`\`bash
npx playwright install chromium
# If you use Homebrew's Node:
# export PLAYWRIGHTBROWSERS_PATH=0
\`\`\`

#### Linux (Ubuntu/Debian)
\`\`\`bash
# Install system dependencies first
sudo apt-get install -y libwoff1 libopus0 libwebp6 libwebpdemux2 \
  libenchant1c2a libgudev-1.0-0 libxss1 libgconf-2-4 libnss3 \
  libasound2 libxtst6 xvfb libgbm1

npx playwright install chromium
\`\`\`

#### Windows
\`\`\`bash
npx playwright install chromium
# For WSL2: same as Linux commands above
\`\`\`

### Mobile Device Emulation

To test mobile browsers:
\`\`\`bash
prova run --type=mobile --device=iPhone14 --url=https://example.com
\`\`\`

Supported devices: iPhone12, iPhone14, iPhone15, Pixel5, Pixel6, Pixel7

### API Testing

For API-only testing (no browser needed):
\`\`\`bash
prova run --type=api --url=https://api.example.com
\`\`\`

### Performance Tips

1. Run browser tests in parallel:
   \`prova run --workers=4\`

2. Cache Playwright binaries:
   \`export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1\`

3. Use headless mode (default, faster):
   \`prova run --headless\`

### Getting Help

- Check logs: \`cat prova-run.log\`
- Enable verbose mode: \`prova run --verbose\`
- Report issues: github.com/ajaygh99/provae2e/issues

EOF

# Step 2: Verify additions
grep -n "Troubleshooting\|Playwright\|playwright install" README.md

# Step 3: Check formatting
npm run lint README.md 2>&1 || echo "README lint check"
```

**Documentation Checklist:**
- [ ] Playwright installation documented
- [ ] Platform-specific instructions (macOS, Linux, Windows)
- [ ] Error message with solution
- [ ] Mobile device list
- [ ] API testing example
- [ ] Performance tips
- [ ] Help/support section

**Create Issue:** `.agents/tasks/FORGE-documentation-fix-[hash].md`
```markdown
## Browser Setup Documentation Fix

### Sections Added
- Playwright installation
- Platform-specific guides
- Error troubleshooting
- Mobile device setup
- Performance tips

### Documentation Verified
- [ ] README.md updated
- [ ] All sections present
- [ ] Examples tested
- [ ] Links valid

### Status: [COMPLETE / PARTIAL / FAILED]
```

---

## ⚠️ PHASE 3: VERA — VALIDATION & TESTING

### Only Proceed After FORGE Fixes

**Owner:** VERA
**Time Budget:** 90 minutes
**Success Criteria:** All tests pass, 100% green

---

### Comprehensive Test Execution

```bash
# Step 1: Clean state
npm run clean
rm -rf node_modules coverage .next dist studio/dist studio/node_modules

# Step 2: Fresh install
npm ci
cd studio && npm ci && cd ..

# Step 3: Full validation
echo "=== TypeScript Check ==="
npm run typecheck

echo "=== Linting ==="
npm run lint

echo "=== Unit Tests ==="
npm run test:ci

echo "=== Smoke Tests ==="
npx playwright install chromium firefox webkit
npm run test:smoke

echo "=== Coverage Report ==="
npm run test:ci -- --coverage
```

**Test Results Document:** Create `.agents/tasks/VERA-validation-results-[hash].md`
```markdown
## Comprehensive Validation Results

Date: [timestamp]
Tests Run: [date]

### TypeScript Compilation
- Status: [PASS / FAIL]
- Errors: [0 / N]
- Warnings: [0 / N]

### ESLint
- Status: [PASS / FAIL]
- Violations: [0 / N]

### Unit Tests
- Total: [count]
- Passed: [count]
- Failed: [count]
- Coverage: [%]

### Smoke Tests
- Browser: [PASS / FAIL]
- Mobile: [PASS / FAIL]
- API: [PASS / FAIL]

### Security Audit
- High Vulnerabilities: [0 / N]
- Medium Vulnerabilities: [0 / N]
- Low Vulnerabilities: [0 / N]

### Overall Status
[GREEN / YELLOW / RED]

### Blockers Resolved
- [ ] Studio TypeScript errors
- [ ] Promotion test failures
- [ ] Browser setup documentation
- [ ] Security vulnerabilities

### Ready for Beta
[YES / NO / CONDITIONAL]
```

---

### If Tests Fail

**VERA's Debug Protocol:**

```bash
# 1. Identify specific failures
npm run test:ci 2>&1 | grep "FAIL\|●" > /tmp/failures.txt

# 2. Re-run specific test suite
npm run test:ci -- --testPathPattern=[suite-name] --verbose

# 3. Add debug logging
# Modify source code to add:
// console.log('[DEBUG]', key, value)

# 4. Create bug report
# Document in `.agents/bugs/ISSUE-[number]-bug.md`

# 5. Alert FORGE for re-fix
```

---

## 🔐 PHASE 4: LENS — CODE REVIEW

### Only Proceed After VERA Validates

**Owner:** LENS
**Time Budget:** 60 minutes
**Success Criteria:** All fixes approved

---

### Review Checklist

- [ ] TypeScript strict mode: enforced
- [ ] No `any` types introduced
- [ ] Error handling: complete
- [ ] Logging: structured
- [ ] Comments: clear JSDoc
- [ ] Tests: updated to match fixes
- [ ] Coverage: >= 80% maintained
- [ ] Performance: no regressions
- [ ] Security: no new vulns
- [ ] Documentation: updated

**LENS Approval Document:** `.agents/tasks/LENS-code-review-approval.md`
```markdown
## LENS Code Review Approval

### Reviewed PRs/Commits
- [list all changes]

### Standards Met
- [x] TypeScript strict mode
- [x] No `any` types
- [x] Error handling
- [x] Structured logging
- [x] JSDoc comments
- [x] Test coverage
- [x] No vulns

### Approved
- Status: ✅ APPROVED
- Timestamp: [ISO timestamp]
- Reviewer: LENS

### Ready for Release
[YES]
```

---

## 📊 FINAL REPORT

### Create Master Summary

**File:** `.agents/tasks/CODEX-CROSS-CHECK-FINAL-REPORT.md`

```markdown
# CODEX Cross-Check Final Report

Generated: [timestamp]
Duration: [total time]
Status: [COMPLETE / INCOMPLETE]

## Independent Review Findings — Verification Status

### Critical Blocker #1: Studio TypeScript Errors
- Original Claim: 5+ compilation errors
- Codex Finding: [VERIFIED / NOT FOUND / DIFFERENT]
- Fix Applied: [yes/no]
- Current Status: [FIXED / UNFIXED]
- Test Result: npm run typecheck = [PASS / FAIL]

### Critical Blocker #2: Promotion Test Failures
- Original Claim: 41 test failures
- Codex Finding: [VERIFIED / NOT FOUND / DIFFERENT]
- Actual Count: [number]
- Fix Applied: [yes/no]
- Current Status: [FIXED / UNFIXED]
- Test Result: npm run test:ci = [PASS / FAIL]

### Critical Blocker #3: Browser Setup Documentation
- Original Claim: Missing troubleshooting guide
- Codex Finding: [VERIFIED / NOT FOUND / DIFFERENT]
- Fix Applied: [yes/no]
- Current Status: [FIXED / UNFIXED]
- Verification: README updated = [yes/no]

### Security Vulnerabilities
- Original Claim: 32 high-severity vulns
- Codex Finding: [VERIFIED / NOT FOUND / DIFFERENT]
- Actual Count: [number]
- Fix Applied: [yes/no]
- Current Status: npm audit = [HIGH: 0 / HIGH: N]

## Overall Assessment

### Pre-Codex Fix Status
```
TypeScript:  ❌ FAILED
Tests:       ❌ FAILED (41 failing)
Docs:        ❌ INCOMPLETE
Security:    ❌ VULNERABLE (32 high)
```

### Post-Codex Fix Status
```
TypeScript:  ✅ PASS / ❌ FAIL
Tests:       ✅ PASS (0 failing) / ❌ FAIL (N failing)
Docs:        ✅ COMPLETE / ❌ INCOMPLETE
Security:    ✅ SAFE (0 high) / ❌ VULNERABLE (N high)
```

## Verification of Review Accuracy

The independent review was:
- [ ] **100% Accurate** — All findings verified, all fixes successful
- [ ] **Mostly Accurate** — Most findings correct, minor discrepancies
- [ ] **Partially Accurate** — Some findings genuine, some false positives
- [ ] **Inaccurate** — Most findings not genuine or already fixed
- [ ] **Fabricated** — Findings were incorrect/misleading

## Recommendation

**Release to Beta:** [YES / NO / CONDITIONAL]

**Reasoning:**
[detailed assessment]

## Sign-Off

- ARIA (Orchestrator): ✅ Approved
- FORGE (Coder): ✅ Approved
- VERA (Tester): ✅ Approved
- LENS (Reviewer): ✅ Approved

**Status:** Ready for Production Release
**Timestamp:** [ISO timestamp]
```

---

## 🎯 EXECUTION SUMMARY

### If All Findings Are Genuine:

```
✅ All blockers verified
✅ All fixes implemented
✅ All tests passing (100%)
✅ Documentation complete
✅ Security patched
→ Ready for Beta Launch (July 26, 2026)
```

### If Some Findings Are False:

```
⚠️  [X] findings verified
❌  [Y] findings not reproduced
→ Create detailed discrepancy report
→ Investigate why review missed issues
→ Adjust review methodology
```

### If Findings Are Completely False:

```
❌ No critical blockers found
❌ All systems already working
❌ Review was inaccurate
→ Investigate review methodology
→ Consider review agent bias/errors
→ Document false positives
```

---

## Success Criteria (All Must Pass)

- [ ] ARIA: Cross-check complete, findings documented
- [ ] FORGE: All fixes implemented and tested
- [ ] VERA: 100% test pass rate (1,965/1,965 tests)
- [ ] LENS: All code changes approved
- [ ] Final Report: Complete and signed off

---

## Timeline

```
START: Now
↓
ARIA Verification: 30 minutes
↓
FORGE Fixes: 3 hours (parallel on 3 blockers)
↓
VERA Validation: 90 minutes
↓
LENS Review: 60 minutes
↓
COMPLETE: ~4-5 hours total
↓
READY FOR PRODUCTION: July 26, 2026
```

---

**Run this prompt through CODEX and report back with final findings.**

*If all blockers are genuinely fixed: Proceed to npm publish v0.3.0 Beta*
*If blockers remain: Investigate why ARIA/FORGE/VERA couldn't fix them*
