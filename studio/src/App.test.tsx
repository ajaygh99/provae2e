import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { RouterProvider } from './router';
import { WorkspaceProvider } from './workspace/WorkspaceContext';

function renderRoute(route: string): void {
  render(
    <WorkspaceProvider>
      <RouterProvider initialPath={route}><App /></RouterProvider>
    </WorkspaceProvider>
  );
}

describe('PROVA Studio application shell', () => {
  it('redirects the root route to the dashboard', async () => {
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: 'Quality at a glance' })).toBeInTheDocument();
  });

  it('shows persistent workspace and profile controls', () => {
    renderRoute('/dashboard');
    expect(screen.getByText('Beta Engineering')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out of PROVA Studio' })).toBeInTheDocument();
  });

  it.each([
    ['/dashboard', 'Dashboard', 'Quality at a glance'],
    ['/builder', 'Test builder', 'Test builder'],
    ['/execution', 'Executions', 'Executions'],
    ['/settings', 'Settings', 'Settings']
  ])('routes %s and highlights %s', (route, linkName, heading) => {
    renderRoute(route);
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: linkName });
    expect(links[0]).toHaveClass('active');
  });

  it('navigates between primary sections', async () => {
    const user = userEvent.setup();
    renderRoute('/dashboard');
    const links = screen.getAllByRole('link', { name: 'Test builder' });
    await user.click(links[0]);
    expect(screen.getByRole('heading', { name: 'Test builder' })).toBeInTheDocument();
  });

  it('redirects unknown routes to the dashboard', async () => {
    renderRoute('/missing');
    expect(await screen.findByRole('heading', { name: 'Quality at a glance' })).toBeInTheDocument();
  });
});
