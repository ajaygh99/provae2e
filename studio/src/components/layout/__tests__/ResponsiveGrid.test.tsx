import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResponsiveGrid } from '../ResponsiveGrid';

describe('ResponsiveGrid', () => {
  it('should render a grid container', () => {
    const { container } = render(
      <ResponsiveGrid>
        <div>Item 1</div>
        <div>Item 2</div>
      </ResponsiveGrid>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toBeInTheDocument();
  });

  it('should render children correctly', () => {
    render(
      <ResponsiveGrid>
        <div>Item 1</div>
        <div>Item 2</div>
        <div>Item 3</div>
      </ResponsiveGrid>
    );
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();
  });

  it('should apply default column classes', () => {
    const { container } = render(
      <ResponsiveGrid>
        <div>Item</div>
      </ResponsiveGrid>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('grid-cols-1');
    expect(grid).toHaveClass('md:grid-cols-2');
    expect(grid).toHaveClass('lg:grid-cols-3');
  });

  it('should apply custom column classes', () => {
    const { container } = render(
      <ResponsiveGrid mobileColumns={1} tabletColumns={3} desktopColumns={4}>
        <div>Item</div>
      </ResponsiveGrid>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('grid-cols-1');
    expect(grid).toHaveClass('md:grid-cols-3');
    expect(grid).toHaveClass('lg:grid-cols-4');
  });

  it('should apply custom gap class', () => {
    const { container } = render(
      <ResponsiveGrid gap="6">
        <div>Item</div>
      </ResponsiveGrid>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('gap-6');
  });

  it('should apply default gap class when not provided', () => {
    const { container } = render(
      <ResponsiveGrid>
        <div>Item</div>
      </ResponsiveGrid>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('gap-4.5');
  });

  it('should apply additional className prop', () => {
    const { container } = render(
      <ResponsiveGrid className="custom-class">
        <div>Item</div>
      </ResponsiveGrid>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('custom-class');
  });

  it('should handle edge case: 2-column layout', () => {
    const { container } = render(
      <ResponsiveGrid mobileColumns={2} tabletColumns={2} desktopColumns={2}>
        <div>Item 1</div>
        <div>Item 2</div>
      </ResponsiveGrid>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('grid-cols-2');
    expect(grid).toHaveClass('md:grid-cols-2');
    expect(grid).toHaveClass('lg:grid-cols-2');
  });

  it('should handle edge case: 6-column layout', () => {
    const { container } = render(
      <ResponsiveGrid mobileColumns={6} tabletColumns={6} desktopColumns={6}>
        <div>Item</div>
      </ResponsiveGrid>
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('grid-cols-6');
  });

  it('should render with complex children', () => {
    render(
      <ResponsiveGrid>
        <article className="metric-card">
          <span>Label</span>
          <strong>Value</strong>
        </article>
        <article className="metric-card">
          <span>Label 2</span>
          <strong>Value 2</strong>
        </article>
      </ResponsiveGrid>
    );
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
  });

  it('should apply grid and responsive classes in correct order', () => {
    const { container } = render(
      <ResponsiveGrid gap="5">
        <div>Item</div>
      </ResponsiveGrid>
    );
    const grid = container.querySelector('.grid');
    const classList = Array.from(grid?.classList || []);
    expect(classList).toContain('grid');
    expect(classList).toContain('grid-cols-1');
    expect(classList).toContain('gap-5');
  });
});
