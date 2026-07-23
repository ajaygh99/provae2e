import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ElementSelectorTool
} from './ElementSelectorTool';
import { createCssSelector, createXPath } from './selector-utils';

describe('selector generation', () => {
  it('prefers IDs, test IDs, and names for stable CSS selectors', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button id="save:button">Save</button>
      <input data-testid="email-field">
      <input name="search">
    `;
    expect(createCssSelector(container.children[0])).toContain('#save');
    expect(createCssSelector(container.children[1])).toBe('[data-testid="email-field"]');
    expect(createCssSelector(container.children[2])).toBe('input[name="search"]');
  });

  it('builds structural CSS selectors with classes and sibling positions', () => {
    const container = document.createElement('main');
    container.innerHTML = '<section><button class="action primary">One</button><button class="action primary">Two</button></section>';
    expect(createCssSelector(container.querySelectorAll('button')[1]))
      .toBe('main > section > button.action.primary:nth-of-type(2)');
  });

  it('builds ID and positional XPath expressions', () => {
    const container = document.createElement('div');
    container.innerHTML = `<span id="quote's">A</span><ul><li>A</li><li>B</li></ul>`;
    expect(createXPath(container.querySelector('span') as Element)).toBe(`//*[@id="quote's"]`);
    expect(createXPath(container.querySelectorAll('li')[1])).toContain('/div/ul/li[2]');
  });
});

describe('ElementSelectorTool', () => {
  it('captures a clicked element as CSS and reports it to the builder', async () => {
    const external = document.createElement('button');
    external.dataset.testid = 'checkout';
    external.textContent = 'Checkout now';
    document.body.append(external);
    const onCapture = vi.fn();
    render(<ElementSelectorTool targetDocument={document} onCapture={onCapture} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick element' }));
    fireEvent.mouseOver(external);
    expect(external).toHaveClass('prova-selector-highlight');
    fireEvent.click(external);
    await waitFor(() => expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({
      format: 'css', value: '[data-testid="checkout"]', tagName: 'button', text: 'Checkout now'
    })));
    expect(screen.getByText('[data-testid="checkout"]')).toBeInTheDocument();
    external.remove();
  });

  it('captures XPath and can cancel picking', async () => {
    const external = document.createElement('a');
    external.id = 'docs';
    document.body.append(external);
    render(<ElementSelectorTool targetDocument={document} />);
    fireEvent.change(screen.getByLabelText('Selector type'), { target: { value: 'xpath' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick element' }));
    expect(screen.getByRole('status')).toHaveTextContent('Hover to highlight');
    fireEvent.click(external);
    await waitFor(() => expect(screen.getByText(`//*[@id='docs']`)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Pick element' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel picking' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    external.remove();
  });

  it('copies a captured selector and handles clipboard denial', async () => {
    const external = document.createElement('input');
    external.name = 'email';
    document.body.append(external);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ElementSelectorTool targetDocument={document} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick element' }));
    fireEvent.click(external);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('input[name="email"]'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copied' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard access was denied');
    external.remove();
  });

  it('renders an iframe preview and URL control by default', () => {
    render(<ElementSelectorTool />);
    fireEvent.change(screen.getByLabelText('Preview URL'), { target: { value: 'http://localhost:3000' } });
    expect(screen.getByTitle('Application preview')).toHaveAttribute('src', 'http://localhost:3000');
  });
});
