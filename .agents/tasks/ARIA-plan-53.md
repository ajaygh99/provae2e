# ARIA Plan #53 — Studio: Responsive Layout System

**Issue:** #53 — Studio: Responsive Layout System
**Assigned to:** FORGE (implementation) + VERA (testing)
**Story Points:** 3
**Labels:** feature, epic:studio, phase3

## Summary
Implement comprehensive responsive layout components and breakpoint system for the PROVA Studio dashboard. The system must support desktop (1024px+), tablet (640px-1023px), and mobile (<640px) views with collapsible sidebar, responsive grid, and mobile menu.

## Acceptance Criteria Analysis
- ✓ Grid/flexbox layout utilities via Tailwind (partially exists; needs formalization)
- ✓ Breakpoint mixin helpers (sm, md, lg, xl) (Tailwind defaults available; expose via utilities)
- ✓ Responsive sidebar (collapse on mobile) (partially exists; needs refinement for mobile menu integration)
- ⬜ Mobile menu component (NEW — hamburger-triggered drawer)
- ✓ Tested on 3+ viewport sizes (unit + component tests)

## Current State
- Tailwind CSS already installed and configured
- `index.css` has some responsive rules but relies on hardcoded media queries
- `AppLayout.tsx` uses `grid-cols-app` and `grid-cols-app-mobile` 
- Sidebar collapses to icon-only view at 760px breakpoint
- Header and content area scale appropriately
- Existing pattern: components use class names, not inline Tailwind classes

## Architecture Plan
### 1. Enhance Tailwind Configuration
- Add explicit breakpoint definitions (sm: 640px, md: 768px, lg: 1024px, xl: 1280px)
- Ensure `gridTemplateColumns` includes responsive variants
- Document breakpoint strategy in JSDoc

### 2. Create Responsive Layout Components
#### a. ResponsiveGrid component
   - Wraps content in a responsive grid container
   - Accepts `columns` prop with defaults per breakpoint
   - Uses Tailwind's responsive classes (e.g., `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)

#### b. MobileMenu component (NEW)
   - Hamburger toggle button visible only on mobile (`md:hidden`)
   - Drawer/modal menu that overlays on mobile
   - Integrates with existing Sidebar navigation
   - Close on item selection
   - ARIA labels for accessibility

#### c. Update AppLayout
   - Integrate MobileMenu trigger
   - Maintain desktop sidebar + mobile drawer pattern
   - State management: track menu open/closed on mobile

### 3. CSS Refactoring
- Migrate hardcoded `@media (max-width: 760px)` rules to Tailwind responsive prefixes where possible
- Maintain semantic class names for layout blocks
- Document responsive breakpoint choices

### 4. Testing Strategy
#### Unit/Component Tests
- MobileMenu: render, toggle open/closed, click-outside to close, keyboard Escape
- ResponsiveGrid: columns prop applied correctly, responsive classes generated
- AppLayout: sidebar visible on desktop, menu trigger visible on mobile

#### Integration Tests
- Sidebar + MobileMenu interaction on mobile
- Navigation flow: desktop sidebar vs mobile menu
- Multi-viewport visual regression: 320px (mobile), 768px (tablet), 1024px (desktop)

## Files to Create/Modify
### Create:
- `studio/src/components/layout/MobileMenu.tsx` — Mobile menu drawer
- `studio/src/components/layout/ResponsiveGrid.tsx` — Responsive grid utility
- `studio/src/components/layout/index.ts` — Layout component exports
- `studio/src/components/layout/__tests__/MobileMenu.test.tsx` — MobileMenu tests
- `studio/src/components/layout/__tests__/ResponsiveGrid.test.tsx` — ResponsiveGrid tests

### Modify:
- `studio/src/components/AppLayout.tsx` — Integrate MobileMenu
- `studio/tailwind.config.ts` — Enhance breakpoint definitions
- `studio/src/index.css` — Add responsive utility classes, migrate media queries

## Technical Decisions
1. **Breakpoints:** Use Tailwind defaults (sm: 640px, md: 768px, lg: 1024px, xl: 1280px) for alignment with ecosystem
2. **Mobile Menu:** Modal drawer pattern (not slide-out sidebar) to avoid layout shift
3. **State Management:** React hooks (useState) for menu open/closed — no external store yet
4. **Testing:** Jest + React Testing Library for component tests; visual testing documented in test comments
5. **Styling:** Stay with Tailwind utility-first approach; no new CSS-in-JS

## Dependencies
- Already installed: react-router-dom, Tailwind CSS, @testing-library/react

## Estimated Effort
- MobileMenu component: 1 story point
- ResponsiveGrid component: 0.5 story points
- Tailwind config + CSS refactoring: 0.5 story points
- Tests (all components): 1 story point
- **Total: 3 story points**

## Done When
- [ ] TypeScript compiles with zero errors
- [ ] ESLint passes with no warnings
- [ ] All tests pass (unit + integration)
- [ ] Code coverage ≥80% for new code
- [ ] Responsive layout works on 320px, 768px, 1024px viewports
- [ ] MobileMenu opens/closes correctly on mobile
- [ ] Navigation flow identical on mobile and desktop

## Notes
- Build test: `npm run build`
- Test: `npm run test` (from studio/ directory)
- Visual testing: Use Chrome DevTools Device Mode (Ctrl+Shift+M) to test at 320px, 768px, 1024px
- Document responsive patterns in Storybook stories if time permits (nice-to-have)
