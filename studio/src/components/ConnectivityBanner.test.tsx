import { act, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ConnectivityBanner } from './ConnectivityBanner';

it('announces offline mode and clears after reconnection', () => {
  render(<ConnectivityBanner />);
  act(() => window.dispatchEvent(new Event('offline')));
  expect(screen.getByRole('status')).toHaveTextContent('Offline');
  act(() => window.dispatchEvent(new Event('online')));
  expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
});
