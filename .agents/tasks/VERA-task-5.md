Issue: #5 — Build HTML report with Allure
Files FORGE will create: src/reporters/allure-reporter.ts
Test file to create: tests/reporters/allure-reporter.test.ts
Behaviors to test:
- Happy path: mixed PASS/FAIL entries produce correct pass/failed/total counts
- Report file is written as a single static HTML file at the expected path
- Screenshots on FAIL entries are inlined (base64) into the HTML, referenced files are read from disk
- Missing/unreadable screenshot path does not throw — handled gracefully
- Duration per test appears in the output for each entry
- Trend section appears when a history file already has prior runs; absent/empty when no history
- History file is created/appended after a report run
- Error path: empty entries array still produces a valid report (0/0)
- Boundary: historyLimit trims older runs beyond the configured limit
Coverage target: 80% minimum
Done when: All tests pass, coverage meets target

VERA: Done. N/N tests pass. Coverage reported below.
