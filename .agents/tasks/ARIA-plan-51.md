# ARIA Plan for Issue #51: Studio TypeScript Strict Mode Setup

## Summary
Configure TypeScript strict mode for the Studio codebase to ensure type safety and prevent `any` types.

## Current State
- Studio project exists at `studio/` with React + Vite setup
- tsconfig.app.json has `strict: true` but lacks explicit `noImplicitAny` and `strictNullChecks`
- eslint.config.js exists with `@typescript-eslint/no-explicit-any: 'error'` rule
- ESLint is linting generated storybook-static directory (should be ignored)
- All existing source files already have proper type annotations

## Files to Create
- `.agents/tasks/FORGE-task-51.md` — coding spec
- `.agents/tasks/VERA-task-51.md` — test requirements

## Files to Study First
- `studio/tsconfig.app.json` — TypeScript configuration
- `studio/eslint.config.js` — ESLint configuration
- `studio/package.json` — Scripts and dependencies
- `README.md` — Documentation to update

## Implementation Plan

### 1. Update studio/tsconfig.app.json
Add explicit compiler options:
- `noImplicitAny: true`
- `strictNullChecks: true`
- `noImplicitThis: true`
- `alwaysStrict: true`

### 2. Update studio/eslint.config.js
- Add `storybook-static` and `dist` to ignores array
- Ensure no `@typescript-eslint/no-explicit-any` bypass rules

### 3. Verify all files pass type checking
- Run `npm run typecheck` in studio/
- Should produce zero errors

### 4. Update README.md
- Add section documenting TypeScript strict mode setup
- List compiler options enabled
- Explain why each option matters for the Studio codebase

## Acceptance Criteria (from Issue #51)
- ✅ tsconfig.json updated with strict: true
- ✅ noImplicitAny enabled
- ✅ strictNullChecks enabled
- ✅ ESLint rules configured to catch 'any' types
- ✅ All existing files pass type checking

## Done When
- TypeScript compiles with zero errors
- ESLint passes with zero errors
- No bypass comments (// @ts-ignore, any) in source files
- README documents the setup
