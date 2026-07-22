import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

/** Provides the persistent navigation and content regions for Studio. */
export function AppLayout(): React.JSX.Element {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-workspace">
        <Header />
        <main className="app-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
