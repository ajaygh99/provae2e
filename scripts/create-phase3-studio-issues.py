#!/usr/bin/env python3
"""
Create Phase 3 Studio issues for PROVA.
Run: python scripts/create-phase3-studio-issues.py

Requires GH_TOKEN environment variable or ~/.gh/hosts.yml GitHub token.
"""

import os
import sys
import json
import requests
from datetime import datetime
from pathlib import Path

# Config
OWNER = "ajaygh99"
REPO = "provae2e"
MILESTONE = "Phase 3 — Studio MVP"
LABELS = ["phase3", "epic:studio", "feature"]

# Story points (Fibonacci distribution)
STORY_POINTS = [3, 5, 8, 13, 5, 3, 8, 5, 3, 8]

ISSUES = [
    # UI Framework & Scaffolding (5 issues)
    {
        "title": "Studio: React dashboard skeleton",
        "body": """## Description
Set up the foundational React dashboard layout for PROVA Studio.

## Acceptance Criteria
- [ ] Create base React app structure with Vite/Webpack
- [ ] Implement responsive dashboard grid layout
- [ ] Set up component directory structure
- [ ] Add basic navigation/sidebar
- [ ] Ensure TypeScript strict mode compliance""",
        "points": 5
    },
    {
        "title": "Studio: Component library setup",
        "body": """## Description
Establish reusable component library with Storybook and documentation.

## Acceptance Criteria
- [ ] Create shared components (Button, Input, Modal, Card)
- [ ] Set up Storybook for component documentation
- [ ] Add component prop typing and validation
- [ ] Create component testing harness
- [ ] Document component usage patterns""",
        "points": 8
    },
    {
        "title": "Studio: TypeScript strict mode enforcement",
        "body": """## Description
Enable and enforce TypeScript strict mode across Studio codebase.

## Acceptance Criteria
- [ ] Enable tsconfig.json strict mode
- [ ] Eliminate all `any` types in existing code
- [ ] Configure ESLint with TypeScript rules
- [ ] Set up pre-commit hooks for type checking
- [ ] Document typing conventions""",
        "points": 3
    },
    {
        "title": "Studio: Tailwind CSS styling system",
        "body": """## Description
Integrate and configure Tailwind CSS with design tokens.

## Acceptance Criteria
- [ ] Install and configure Tailwind CSS
- [ ] Create design token system (colors, spacing, typography)
- [ ] Set up theme customization
- [ ] Create CSS utility class conventions
- [ ] Build component styling guide""",
        "points": 5
    },
    {
        "title": "Studio: Responsive layout framework",
        "body": """## Description
Implement responsive grid and layout components.

## Acceptance Criteria
- [ ] Create Grid and Flex layout components
- [ ] Test breakpoints (mobile, tablet, desktop)
- [ ] Add responsive utility hooks
- [ ] Document layout patterns
- [ ] Ensure accessibility compliance""",
        "points": 5
    },

    # Test Builder UI (15 issues)
    {
        "title": "Studio: Drag-and-drop test canvas",
        "body": """## Description
Implement drag-and-drop canvas for visual test step composition.

## Acceptance Criteria
- [ ] Create draggable canvas component
- [ ] Implement step drop zones
- [ ] Add visual feedback for drag/drop state
- [ ] Support undo/redo via drag operations
- [ ] Persist canvas state to localStorage""",
        "points": 8
    },
    {
        "title": "Studio: Test step add/edit panel",
        "body": """## Description
Build UI for adding and editing individual test steps.

## Acceptance Criteria
- [ ] Create step editor modal
- [ ] Support step type selection (click, fill, assert, wait)
- [ ] Implement property editor for step config
- [ ] Add step preview rendering
- [ ] Validate step configuration""",
        "points": 5
    },
    {
        "title": "Studio: Element selector inspector",
        "body": """## Description
Create browser element selector tool with multi-strategy fallback.

## Acceptance Criteria
- [ ] Implement element highlight on hover
- [ ] Support CSS selector, XPath, and text strategies
- [ ] Generate 5-tier fallback selectors
- [ ] Add selector validation and testing
- [ ] Store selector suggestion history""",
        "points": 8
    },
    {
        "title": "Studio: Assertion builder UI",
        "body": """## Description
Create visual assertion builder for test validations.

## Acceptance Criteria
- [ ] Support assertions: visibility, text, attribute, count
- [ ] Implement assertion chain composition
- [ ] Add assertion preview on target element
- [ ] Validate assertion configuration
- [ ] Export assertions to test script""",
        "points": 5
    },
    {
        "title": "Studio: Wait condition selector",
        "body": """## Description
Implement UI for configuring test wait conditions.

## Acceptance Criteria
- [ ] Support wait types: element, timeout, function
- [ ] Add condition validator
- [ ] Provide wait time estimation
- [ ] Allow condition chaining
- [ ] Test condition execution""",
        "points": 3
    },
    {
        "title": "Studio: Screenshot capture integration",
        "body": """## Description
Add screenshot capture UI and storage for test evidence.

## Acceptance Criteria
- [ ] Capture screenshots at test step points
- [ ] Store screenshots with metadata (timestamp, device)
- [ ] Display screenshot gallery in test results
- [ ] Support annotation on screenshots
- [ ] Compress images for storage""",
        "points": 5
    },
    {
        "title": "Studio: Test library management",
        "body": """## Description
Implement UI for creating and organizing test step libraries.

## Acceptance Criteria
- [ ] Create step templates library
- [ ] Support library search and filtering
- [ ] Enable library sharing between tests
- [ ] Version library components
- [ ] Document library usage""",
        "points": 5
    },
    {
        "title": "Studio: Reusable test steps",
        "body": """## Description
Enable creation and reuse of multi-step test components.

## Acceptance Criteria
- [ ] Create composable step groups
- [ ] Support step parameterization
- [ ] Implement step validation
- [ ] Test step execution in isolation
- [ ] Document step composition patterns""",
        "points": 5
    },
    {
        "title": "Studio: Step documentation generator",
        "body": """## Description
Auto-generate documentation from test steps and assertions.

## Acceptance Criteria
- [ ] Parse step configuration to docs
- [ ] Generate human-readable test narratives
- [ ] Create assertion summary tables
- [ ] Export documentation as Markdown
- [ ] Include screenshot references""",
        "points": 3
    },
    {
        "title": "Studio: Undo/redo functionality",
        "body": """## Description
Implement comprehensive undo/redo for all test builder operations.

## Acceptance Criteria
- [ ] Support undo/redo for step add/remove/edit
- [ ] Limit history to last 50 actions
- [ ] Show undo/redo state in UI
- [ ] Persist history during session
- [ ] Clear history on save""",
        "points": 5
    },
    {
        "title": "Studio: Test save/load system",
        "body": """## Description
Create persistent storage and retrieval of test definitions.

## Acceptance Criteria
- [ ] Save tests to SQLite backend
- [ ] Support test export to JSON/YAML
- [ ] Enable test import from external files
- [ ] Create test backup functionality
- [ ] Track save timestamps and versions""",
        "points": 5
    },
    {
        "title": "Studio: Test versioning",
        "body": """## Description
Implement test version control and history tracking.

## Acceptance Criteria
- [ ] Create version snapshots on save
- [ ] Support rollback to previous versions
- [ ] Show version diff UI
- [ ] Track version metadata (author, timestamp)
- [ ] Clean up old versions (retention policy)""",
        "points": 5
    },
    {
        "title": "Studio: Test cloning and templates",
        "body": """## Description
Enable test cloning and template-based test creation.

## Acceptance Criteria
- [ ] Create clone test from existing
- [ ] Support test templates with placeholders
- [ ] Implement template parameter substitution
- [ ] Organize templates by category
- [ ] Support community template sharing""",
        "points": 3
    },
    {
        "title": "Studio: Bulk test editing",
        "body": """## Description
Allow batch operations on multiple tests.

## Acceptance Criteria
- [ ] Support multi-select in test list
- [ ] Enable bulk edit (tags, device type, timeout)
- [ ] Batch delete with confirmation
- [ ] Bulk export selected tests
- [ ] Show operation progress""",
        "points": 3
    },
    {
        "title": "Studio: Test search and filtering",
        "body": """## Description
Implement advanced search and filtering for test library.

## Acceptance Criteria
- [ ] Full-text search across test names and descriptions
- [ ] Filter by tags, status, device type
- [ ] Support saved search filters
- [ ] Show search result count
- [ ] Highlight matching terms in results""",
        "points": 3
    },

    # Execution Viewer (10 issues)
    {
        "title": "Studio: Live execution dashboard",
        "body": """## Description
Real-time dashboard showing running test execution status.

## Acceptance Criteria
- [ ] Display live test run timeline
- [ ] Show pass/fail status per step
- [ ] Update metrics in real-time
- [ ] Support pause/resume execution
- [ ] Stream logs to dashboard""",
        "points": 8
    },
    {
        "title": "Studio: Step-by-step results viewer",
        "body": """## Description
Detailed view of each test step outcome and details.

## Acceptance Criteria
- [ ] Display step input and output
- [ ] Show assertions and their results
- [ ] Highlight failed assertions
- [ ] Include execution timing
- [ ] Display element state snapshots""",
        "points": 5
    },
    {
        "title": "Studio: Screenshot evidence gallery",
        "body": """## Description
Gallery interface for reviewing test evidence screenshots.

## Acceptance Criteria
- [ ] Display screenshots chronologically
- [ ] Support fullscreen image view
- [ ] Add image annotation tools
- [ ] Enable side-by-side comparison
- [ ] Export screenshot report""",
        "points": 5
    },
    {
        "title": "Studio: Video playback of test execution",
        "body": """## Description
Play back video recording of test execution run.

## Acceptance Criteria
- [ ] Record test execution video
- [ ] Support play/pause/seek controls
- [ ] Sync video with step timeline
- [ ] Highlight interactions on video
- [ ] Support video download""",
        "points": 8
    },
    {
        "title": "Studio: Performance metrics display",
        "body": """## Description
Show performance data from test execution.

## Acceptance Criteria
- [ ] Display step execution times
- [ ] Show page load timing
- [ ] Track network requests
- [ ] Identify performance bottlenecks
- [ ] Create performance trend charts""",
        "points": 5
    },
    {
        "title": "Studio: Error details and stack traces",
        "body": """## Description
Detailed error information for failed tests.

## Acceptance Criteria
- [ ] Display full error messages
- [ ] Show JavaScript stack traces
- [ ] Include browser console logs
- [ ] Highlight error source code
- [ ] Suggest fixes for common errors""",
        "points": 3
    },
    {
        "title": "Studio: Test retry capability",
        "body": """## Description
Enable re-running failed tests from the results UI.

## Acceptance Criteria
- [ ] Support retry from specific step
- [ ] Retry from beginning of test
- [ ] Configure retry attempts
- [ ] Compare retried results with original
- [ ] Track retry history""",
        "points": 3
    },
    {
        "title": "Studio: Results export and reporting",
        "body": """## Description
Export test results in multiple formats.

## Acceptance Criteria
- [ ] Export to HTML report
- [ ] Generate PDF test report
- [ ] Create JSON results export
- [ ] Include screenshots in exports
- [ ] Support custom report templates""",
        "points": 5
    },
    {
        "title": "Studio: Compare test runs",
        "body": """## Description
Side-by-side comparison of multiple test executions.

## Acceptance Criteria
- [ ] Select runs to compare
- [ ] Highlight differences in results
- [ ] Show timing deltas
- [ ] Compare screenshots from runs
- [ ] Create regression analysis""",
        "points": 5
    },
    {
        "title": "Studio: Results trend charts",
        "body": """## Description
Visualize test result trends over time.

## Acceptance Criteria
- [ ] Chart pass/fail rate by time
- [ ] Show execution time trends
- [ ] Display flaky test detection
- [ ] Identify performance degradation
- [ ] Create SLA compliance charts""",
        "points": 3
    },

    # Integration & Auth (10 issues)
    {
        "title": "Studio: GitHub OAuth integration",
        "body": """## Description
Implement GitHub OAuth login for PROVA Studio.

## Acceptance Criteria
- [ ] Configure GitHub OAuth app
- [ ] Implement login flow
- [ ] Store user credentials securely
- [ ] Add logout functionality
- [ ] Handle OAuth token refresh""",
        "points": 5
    },
    {
        "title": "Studio: JIRA connector",
        "body": """## Description
Connect Studio to JIRA for issue tracking integration.

## Acceptance Criteria
- [ ] Authenticate with JIRA API
- [ ] Link tests to JIRA issues
- [ ] Create JIRA issues from test failures
- [ ] Update JIRA from test results
- [ ] Support custom field mapping""",
        "points": 5
    },
    {
        "title": "Studio: Figma design sync",
        "body": """## Description
Sync UI element selectors from Figma designs.

## Acceptance Criteria
- [ ] Connect to Figma API
- [ ] Import design tokens
- [ ] Map Figma elements to selectors
- [ ] Detect selector changes
- [ ] Notify on design updates""",
        "points": 8
    },
    {
        "title": "Studio: Team workspace management",
        "body": """## Description
Enable multi-user workspaces and team collaboration.

## Acceptance Criteria
- [ ] Create workspace and invite users
- [ ] Support role-based access (admin, tester, viewer)
- [ ] Track workspace audit logs
- [ ] Share tests within workspace
- [ ] Set workspace-level settings""",
        "points": 5
    },
    {
        "title": "Studio: User permissions and roles",
        "body": """## Description
Implement granular permission system for Studio access.

## Acceptance Criteria
- [ ] Define roles (owner, admin, tester, viewer)
- [ ] Set permissions per resource (test, suite, report)
- [ ] Support custom role creation
- [ ] Audit permission changes
- [ ] Enforce permissions on API""",
        "points": 5
    },
    {
        "title": "Studio: API key management",
        "body": """## Description
Allow users to manage API keys for programmatic access.

## Acceptance Criteria
- [ ] Generate API keys UI
- [ ] Display key with secret once
- [ ] Revoke API keys
- [ ] Track key usage
- [ ] Set key expiration""",
        "points": 3
    },
    {
        "title": "Studio: Test library sharing",
        "body": """## Description
Enable sharing of test components and libraries across teams.

## Acceptance Criteria
- [ ] Export library as package
- [ ] Publish to private registry
- [ ] Support library versioning
- [ ] Manage library dependencies
- [ ] Enable community sharing""",
        "points": 5
    },
    {
        "title": "Studio: Slack notifications",
        "body": """## Description
Send test results and alerts to Slack.

## Acceptance Criteria
- [ ] Configure Slack webhook
- [ ] Send test completion notifications
- [ ] Alert on test failures
- [ ] Create Slack command for test status
- [ ] Support rich message formatting""",
        "points": 3
    },
    {
        "title": "Studio: CLI integration",
        "body": """## Description
Enable Studio tests to run from PROVA CLI.

## Acceptance Criteria
- [ ] Export Studio test to CLI format
- [ ] Execute Studio tests via qe-tool run
- [ ] Pass CLI parameters to Studio tests
- [ ] Sync CLI results back to Studio
- [ ] Support CI/CD pipeline integration""",
        "points": 5
    },
    {
        "title": "Studio: Cloud storage (S3) integration",
        "body": """## Description
Store screenshots, videos, and reports in S3.

## Acceptance Criteria
- [ ] Configure S3 bucket
- [ ] Upload artifacts to S3
- [ ] Generate signed URLs for access
- [ ] Manage storage retention policy
- [ ] Support custom storage backends""",
        "points": 5
    },
]

def get_github_token():
    """Read GitHub token from environment or gh config."""
    # Try environment variable
    token = os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN")
    if token:
        return token

    # Try ~/.gh/hosts.yml
    gh_config = Path.home() / ".config" / "gh" / "hosts.yml"
    if gh_config.exists():
        import yaml
        with open(gh_config) as f:
            config = yaml.safe_load(f)
            if config and "github.com" in config:
                return config["github.com"].get("oauth_token")

    raise ValueError(
        "GitHub token not found. Set GH_TOKEN or GITHUB_TOKEN environment variable."
    )

def create_issue(token, title, body, points=None):
    """Create a single issue via GitHub API."""
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/issues"

    issue_labels = LABELS.copy()

    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }

    data = {
        "title": title,
        "body": body if not points else f"{body}\n\n**Story Points:** {points}",
        "labels": issue_labels,
    }

    resp = requests.post(url, json=data, headers=headers)
    resp.raise_for_status()
    return resp.json()

def main():
    print("🚀 PROVA Phase 3 Studio Issues Creator")
    print(f"📅 {datetime.now().isoformat()}")
    print(f"📦 Target: {OWNER}/{REPO}")
    print(f"🏷️  Labels: {', '.join(LABELS)}")
    print(f"📊 Issues: {len(ISSUES)}")
    print()

    try:
        token = get_github_token()
        print("✅ GitHub token loaded\n")
    except ValueError as e:
        print(f"❌ {e}")
        sys.exit(1)

    created = []
    failed = []

    for i, issue in enumerate(ISSUES, 1):
        try:
            result = create_issue(token, issue["title"], issue["body"], issue.get("points"))
            created.append(result)
            print(f"✅ [{i:2d}/40] #{result['number']}: {issue['title'][:60]}")
        except Exception as e:
            failed.append((issue["title"], str(e)))
            print(f"❌ [{i:2d}/40] FAILED: {issue['title'][:60]}")
            print(f"    Error: {e}")

    print()
    print(f"📊 Summary: {len(created)}/40 created, {len(failed)} failed")

    if created:
        issue_nums = [str(issue["number"]) for issue in created]
        print(f"🔗 Issues: #{issue_nums[0]}-#{issue_nums[-1]}")

    if failed:
        print("\n⚠️  Failed issues:")
        for title, error in failed:
            print(f"  - {title}: {error}")
        sys.exit(1)

    print("\n✨ All issues created successfully!")

if __name__ == "__main__":
    main()
