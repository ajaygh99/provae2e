import { useEffect } from 'react';
import { AppLayout } from './components/AppLayout';
import { ConnectivityBanner } from './components/ConnectivityBanner';
import { BuilderPage } from './pages/BuilderPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExecutionPage } from './pages/ExecutionPage';
import { SettingsPage } from './pages/SettingsPage';
import { useRouter } from './router';

const pages: Record<string, React.JSX.Element> = {
  '/dashboard': <DashboardPage />,
  '/builder': <BuilderPage />,
  '/execution': <ExecutionPage />,
  '/settings': <SettingsPage />
};

/** Renders the routed PROVA Studio application shell. */
export function App(): React.JSX.Element {
  const { pathname, navigate } = useRouter();
  const page = pages[pathname] ?? pages['/dashboard'];

  useEffect(() => {
    if (!pages[pathname]) navigate('/dashboard', true);
  }, [navigate, pathname]);

  return <AppLayout><ConnectivityBanner />{page}</AppLayout>;
}
