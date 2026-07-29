import { useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Navigation } from './Navigation';
import { MobileMenu } from './layout';

/** Provides the persistent navigation and content regions for Studio. */
export function AppLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [, setMobileMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
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
          {children}
        </main>
      </div>
    </div>
  );
}
