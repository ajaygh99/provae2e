# ARIA Plan - Issue #49

## Objective

Create the first isolated PROVA Studio application boundary as a React, TypeScript, and Vite web application.

## Architecture

- Keep the published `@provae2e/cli` package unchanged.
- Place the browser application in `studio/` with its own dependency lock and build lifecycle.
- Use React Router v6 for dashboard, builder, execution, and settings routes.
- Establish a persistent desktop-first application shell with a responsive narrow-screen layout.
- Validate Studio independently and add it to repository CI in this PR.

## Verification

- TypeScript strict-mode build succeeds.
- ESLint succeeds with no errors.
- Component and routing tests pass.
- Production Vite bundle succeeds.
- Existing CLI typecheck, lint, and tests remain green.
