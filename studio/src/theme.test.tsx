import { describe, expect, it } from 'vitest'
import tailwindConfig from '../tailwind.config'

/**
 * Theme configuration tests ensure PROVA brand colors and design tokens
 * are properly defined and accessible throughout the component library.
 */
describe('Tailwind theme configuration', () => {
  it('defines the custom PROVA color palette', () => {
    const theme = tailwindConfig.theme?.extend?.colors as Record<string, unknown>
    expect(theme).toBeDefined()
    expect(theme.prova).toBeDefined()
  })

  it('includes primary brand colors', () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, Record<string, unknown>>
    expect(colors.prova.primary).toBe('#5d4cf5')
    expect(colors.prova['primary-light']).toBe('#6d5dfc')
  })

  it('includes text color hierarchy', () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, Record<string, Record<string, unknown>>>
    const text = colors.prova.text
    expect(text.DEFAULT).toBe('#17213b')
    expect(text.secondary).toBe('#34405f')
    expect(text.tertiary).toBe('#68738f')
  })

  it('includes sidebar theme colors', () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, Record<string, unknown>>
    expect(colors.prova.sidebar).toBe('#101936')
    expect(colors.prova['sidebar-text']).toBe('#dfe6ff')
  })

  it('includes background color variants', () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, Record<string, Record<string, unknown>>>
    const bg = colors.prova.bg
    expect(bg.DEFAULT).toBe('#f5f7fb')
    expect(bg.surface).toBe('#ffffff')
  })

  it('includes semantic colors (success, warning, error, info)', () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, Record<string, unknown>>
    expect(colors.prova.success).toBe('#35d39d')
    expect(colors.prova.warning).toBe('#c9364b')
    expect(colors.prova.info).toBe('#34405f')
  })

  it('defines custom spacing scale', () => {
    const spacing = tailwindConfig.theme?.extend?.spacing as Record<string, unknown>
    expect(spacing).toBeDefined()
    expect(spacing['0']).toBe('0')
    expect(spacing['1']).toBe('4px')
    expect(spacing['8']).toBe('32px')
  })

  it('defines custom border radius scale', () => {
    const borderRadius = tailwindConfig.theme?.extend?.borderRadius as Record<string, unknown>
    expect(borderRadius).toBeDefined()
    expect(borderRadius.sm).toBe('8px')
    expect(borderRadius.lg).toBe('12px')
  })

  it('defines typography scale', () => {
    const fontSize = tailwindConfig.theme?.extend?.fontSize as Record<string, unknown[]>
    expect(fontSize).toBeDefined()
    expect(fontSize.xs).toBeDefined()
    expect(fontSize['3xl']).toBeDefined()
  })

  it('defines custom box shadows', () => {
    const boxShadow = tailwindConfig.theme?.extend?.boxShadow as Record<string, unknown>
    expect(boxShadow).toBeDefined()
    expect(boxShadow.sm).toBeDefined()
    expect(boxShadow.lg).toBeDefined()
  })

  it('defines custom z-index values for layers', () => {
    const zIndex = tailwindConfig.theme?.extend?.zIndex as Record<string, unknown>
    expect(zIndex).toBeDefined()
    expect(zIndex['modal-backdrop']).toBe('50')
    expect(zIndex.modal).toBe('51')
    expect(zIndex.toast).toBe('60')
  })

  it('defines grid template columns for app layout', () => {
    const gridTemplateColumns = tailwindConfig.theme?.extend?.gridTemplateColumns as Record<string, unknown>
    expect(gridTemplateColumns).toBeDefined()
    expect(gridTemplateColumns.app).toBeDefined()
    expect(gridTemplateColumns['3-col']).toBeDefined()
  })

  it('enables content purging for correct files', () => {
    expect(tailwindConfig.content).toContain('./src/**/*.{js,ts,jsx,tsx}')
  })
})
