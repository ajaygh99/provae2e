# Beta Launch Security and Product Boundaries

## Public beta position

`@provae2e/cli@0.3.5-beta.1` is a public MIT-licensed community beta. Public
source and published npm archives can be downloaded, studied, modified, and
redistributed under the MIT license. Making future development private cannot
revoke rights already granted or recover existing copies.

Do not place proprietary Phase 4 services, commercial connector credentials,
license-enforcement secrets, customer data, or private operational logic in
this public repository or public npm package.

## Recommended open-core boundary

Public community repository:

- CLI and documented SDK contracts;
- browser, mobile-web, and API execution foundation;
- local reports and safe starter integrations;
- examples, templates, and community documentation.

Private commercial repositories or services:

- hosted Studio and organization administration;
- multi-tenant control plane, queues, scheduling, and autoscaling;
- enterprise connectors and customer-specific mappings;
- compliance workflows, policy packs, and managed audit retention;
- commercial analytics, billing, entitlement, and license services;
- production secrets, deployment configuration, and incident operations.

The public package should call private services through versioned,
authenticated APIs. Proprietary logic and authorization decisions remain
server-side.

## Beta-user operating instructions

1. Use a non-production test environment and synthetic accounts.
2. Grant least-privilege, short-lived credentials.
3. Keep destructive OpenAPI execution disabled unless a test owner approves it.
4. Review selector-repair proposals before approval.
5. Secret-scan evidence before sharing it.
6. Set artifact retention and delete test data after the agreed period.
7. Report vulnerabilities privately using `SECURITY.md`.

## Website statements required before signup

The beta website must state beta status and limitations, supported platforms,
local versus externally transmitted data, credential responsibilities, the MIT
community license, lack of a production warranty during beta, support and
security-reporting channels, and reviewed privacy, usage, and beta terms.

This document is engineering guidance, not legal advice.
