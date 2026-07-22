import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Navigation } from './Navigation';
import { MobileMenu } from './layout';

/** Provides the persistent navigation and content regions for Studio. */
export function AppLayout(): React.JSX.Element {
  const [, setMobileMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar />
      <MobileMenu onToggle={setMobileMenuOpen}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          <div><strong>PROVA</strong><span>Studio</span></div>
        </div>
        <Navigation onNavigate={() => setMobileMenuOpen(false)} />
      </MobileMenu>
      <div className="app-workspace">
        <Header />
        <main className="app-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
