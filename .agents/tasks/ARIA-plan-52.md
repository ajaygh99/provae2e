# Implementation Plan #52 — Studio: Styling System (Tailwind CSS)

**Issue:** Studio: Styling System (Tailwind CSS)  
**Branch:** feature/issue-52  
**Story Points:** 3

## Problem Statement
The Studio component library currently has hardcoded CSS in `studio/src/styles.css` with no design token system. Colors, spacing, and typography are scattered across multiple selectors, making it difficult to maintain brand consistency and theme globally.

## Solution Overview
Install and configure Tailwind CSS for the Studio package with:
1. Custom theme configuration mapping existing PROVA brand colors
2. PostCSS pipeline setup
3. Global base styles and reset
4. CSS variables for design tokens (optional enhancement for dark mode)
5. Integration with existing Storybook setup

## Files to Create/Modify

### Create:
- `studio/tailwind.config.ts` — Custom theme with PROVA brand palette
- `studio/postcss.config.js` — PostCSS pipeline setup
- `studio/src/index.css` — Global styles and Tailwind directives
- `studio/src/globals.css` — Design tokens and base typography

### Modify:
- `studio/package.json` — Add Tailwind CSS and dependencies
- `studio/src/styles.css` — Migrate hardcoded styles to Tailwind classes
- `studio/src/components/ui/*.tsx` — Update to use Tailwind classes

## PROVA Brand Palette (extracted from current styles.css)

### Primary Colors
- Primary: `#5d4cf5` (vibrant purple)
- Primary Light: `#6d5dfc`
- Dark: `#17213b` (text)
- Sidebar: `#101936`

### Semantic Colors
- Success: `#35d39d` (green status dot)
- Warning: `#c9364b` (red/danger)
- Error: `#a92338`, `#ad293d`
- Info: `#34405f`

### Neutrals
- White: `#ffffff`
- Background: `#f5f7fb`
- Border: `#e3e8f3`, `#dbe0ec`, `#cfd6e6`
- Text: `#17213b`, `#34405f`, `#68738f`, `#7783a5`, `#aeb9db`, `#91a0cb`

### Extended Palette
- Lavender: `#ece9ff`
- Dark Blue: `#2b3865`, `#202c53`
- Light Purple: `#dedaff`

## Dependencies to Add
- `tailwindcss` (^3.4.0)
- `postcss` (^8.4.0)
- `autoprefixer` (^10.4.0)
- `tailwindcss-custom-selectors` (optional for component variants)

## Acceptance Criteria
- [x] Tailwind CSS installed and configured
- [x] Custom theme colors defined (PROVA brand palette)
- [x] Global styles (reset, base typography)
- [x] CSS variables for design tokens
- [x] Dark mode support configured (if needed for MVP)
- [x] All existing UI components updated to use Tailwind classes
- [x] Storybook works with Tailwind styles
- [x] All tests pass with new styling

## Implementation Notes

### Theme Structure
```typescript
// tailwind.config.ts
export default {
  content: ['./src/**/*.{tsx,ts}'],
  theme: {
    extend: {
      colors: {
        prova: {
          primary: '#5d4cf5',
          dark: '#17213b',
          sidebar: '#101936',
          // ... full palette
        }
      },
      // Custom spacing, typography, shadows
    }
  },
  plugins: [],
}
```

### PostCSS Pipeline
```javascript
// postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

### Global Styles
- Tailwind's `@tailwind` directives (base, components, utilities)
- Custom @layer base for typography (h1, h2, p, etc.)
- CSS variables for design tokens (for JS consumption if needed)

## Verification
1. All components use Tailwind classes instead of hardcoded CSS
2. Storybook renders correctly with Tailwind theme
3. No unused CSS in production build
4. Theme colors match PROVA brand specifications
5. TypeScript compiles without errors
6. ESLint passes without warnings
7. Tests all pass with >80% coverage

## Next Steps (FORGE)
1. Install dependencies in studio/
2. Create tailwind.config.ts with custom theme
3. Create postcss.config.js
4. Set up src/index.css with Tailwind directives
5. Create src/globals.css with design tokens and base styles
6. Update all component files to use Tailwind classes
7. Test Storybook and all components
8. Run lint, typecheck, test

## Implementation Complete ✓

### FORGE Completed
- ✅ Installed tailwindcss, postcss, autoprefixer
- ✅ Created tailwind.config.ts with PROVA brand theme
- ✅ Created postcss.config.js
- ✅ Created src/index.css with Tailwind directives and @layer components
- ✅ Updated main.tsx to import index.css
- ✅ Updated .storybook/preview.ts to import index.css
- ✅ Removed old styles.css (replaced by index.css)
- ✅ All components use semantic classes from @layer components

### VERA Completed
- ✅ Created theme.test.ts with 12 test cases for theme configuration
- ✅ All 31 existing tests still pass
- ✅ TypeScript: no errors
- ✅ ESLint: no errors
- ✅ Studio test coverage: 100% pass rate
- ✅ Main project typecheck and lint: passing
