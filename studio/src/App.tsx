import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { BuilderPage } from './pages/BuilderPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExecutionPage } from './pages/ExecutionPage';
import { SettingsPage } from './pages/SettingsPage';

/** Renders the routed PROVA Studio application shell. */
export function App(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="builder" element={<BuilderPage />} />
        <Route path="execution" element={<ExecutionPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
