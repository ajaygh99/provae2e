# Security Policy

## Supported versions

PROVA is currently a beta product. Security fixes are provided only for the
latest published beta version.

| Version | Supported |
|---|---|
| 0.3.5-beta.1 | Yes |
| Earlier versions | No |

## Report a vulnerability privately

Do not open a public issue and do not include a real credential, customer URL,
personal information, exploit payload, or production artifact in a public
discussion.

Use GitHub's private vulnerability reporting:

https://github.com/ajaygh99/provae2e/security/advisories/new

Include the affected version and operating system, minimum reproduction steps
using synthetic data, expected and observed behavior, potential impact, and a
suggested remediation if available.

The project will target acknowledgement within three business days and an
initial severity assessment within seven business days. These are response
targets, not a paid support SLA.

## Security boundaries

- PROVA executes user-supplied tests and can access systems the user authorizes.
- Credentials belong in environment variables or approved secret stores, never
  in committed tests, configuration, screenshots, logs, or traces.
- Destructive API operations remain opt-in and require explicit approval.
- Local selector-learning data must not contain credentials, emails, or PII.
- External connectors have their own security and privacy terms.

## Release security

Releases require protected-branch review, automated tests, dependency audit,
secret scanning, CodeQL analysis, an approved release record, and an
authenticated release workflow. Never publish from an unreviewed local build.
