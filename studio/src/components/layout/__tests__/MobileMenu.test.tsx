import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileMenu } from '../MobileMenu';

describe('MobileMenu', () => {
  it('should render hamburger button', () => {
    render(<MobileMenu>Menu content</MobileMenu>);
    const button = screen.getByRole('button', { name: /open navigation menu/i });
    expect(button).toBeInTheDocument();
  });

  it('should toggle menu open/closed on button click', () => {
    render(<MobileMenu>Menu content</MobileMenu>);
    const button = screen.getByRole('button', { name: /open navigation menu/i });

    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-label', 'Close navigation menu');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-label', 'Open navigation menu');
  });

  it('should display menu content when open', () => {
    render(<MobileMenu>Menu content</MobileMenu>);
    const button = screen.getByRole('button', { name: /open navigation menu/i });
    const content = screen.getByText('Menu content');

    fireEvent.click(button);
    expect(content).toBeInTheDocument();
  });

  it('should close menu when clicking outside', () => {
    const { container } = render(<MobileMenu>Menu content</MobileMenu>);
    const button = screen.getByRole('button', { name: /open navigation menu/i });

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    // Click on the backdrop
    const backdrop = container.querySelector('[aria-hidden="true"]');
    if (backdrop) {
      fireEvent.click(backdrop);
    }

    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('should close menu when Escape key is pressed', () => {
    render(<MobileMenu>Menu content</MobileMenu>);
    const button = screen.getByRole('button', { name: /open navigation menu/i });

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('should call onToggle callback with correct state', () => {
    const onToggle = vi.fn();
    render(<MobileMenu onToggle={onToggle}>Menu content</MobileMenu>);
    const button = screen.getByRole('button', { name: /open navigation menu/i });

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(true);

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('should close menu when content item is clicked', () => {
    render(
      <MobileMenu>
        <button>Menu item</button>
      </MobileMenu>
    );
    const hamburger = screen.getByRole('button', { name: /open navigation menu/i });

    fireEvent.click(hamburger);
    expect(hamburger).toHaveAttribute('aria-expanded', 'true');

    const menuItem = screen.getByRole('button', { name: /menu item/i });
    fireEvent.click(menuItem);
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });

  it('should render with proper ARIA labels', () => {
    render(<MobileMenu>Menu content</MobileMenu>);
    const button = screen.getByRole('button', { name: /open navigation menu/i });

    expect(button).toHaveAttribute('aria-expanded');
    expect(button).toHaveAttribute('aria-label');
    expect(button).toHaveAttribute('aria-controls', 'mobile-navigation-drawer');
    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
  });

  it('moves focus into the drawer and restores it after Escape', () => {
    render(<MobileMenu><a href="#destination">First destination</a></MobileMenu>);
    const button = screen.getByRole('button', { name: /open navigation menu/i });
    fireEvent.click(button);
    expect(screen.getByRole('link', { name: 'First destination' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveFocus();
  });

  it('should handle rapid open/close toggling', () => {
    render(<MobileMenu>Menu content</MobileMenu>);
    const button = screen.getByRole('button', { name: /open navigation menu/i });

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
