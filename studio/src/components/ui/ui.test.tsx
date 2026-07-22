import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, Modal, Select, Textarea, TextField, Toast } from '.';

describe('Studio component library', () => {
  it.each(['primary', 'secondary', 'danger'] as const)('renders the %s button variant', (variant) => {
    render(<Button variant={variant}>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(`ui-button--${variant}`);
  });

  it('disables a loading button and announces progress', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('connects text field validation to its input', () => {
    render(<TextField label="Name" error="Name is required" />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Name is required');
  });

  it('renders a labelled textarea with hint text', () => {
    render(<Textarea label="Description" hint="Markdown supported" />);
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAccessibleDescription('Markdown supported');
  });

  it('renders select options and reports validation', () => {
    render(<Select label="Browser" error="Choose a browser" options={[{ value: 'chromium', label: 'Chromium' }]} />);
    expect(screen.getByRole('combobox', { name: 'Browser' })).toHaveAccessibleDescription('Choose a browser');
    expect(screen.getByRole('option', { name: 'Chromium' })).toBeInTheDocument();
  });

  it('closes a modal with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open title="Delete test" onClose={onClose}><p>Confirm deletion</p></Modal>);
    expect(screen.getByRole('dialog', { name: 'Delete test' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not render a closed modal', () => {
    render(<Modal open={false} title="Hidden" onClose={vi.fn()}>Nothing</Modal>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('announces errors assertively and dismisses a toast', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Toast tone="error" message="Run failed" onDismiss={onDismiss} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Run failed');
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
