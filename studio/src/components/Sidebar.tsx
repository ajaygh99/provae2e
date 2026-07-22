import { Navigation } from './Navigation';

/** Renders Studio's primary route navigation with active-state semantics. */
export function Sidebar(): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">P</span>
        <div><strong>PROVA</strong><span>Studio</span></div>
      </div>
      <Navigation />
      <div className="sidebar-status">
        <span className="status-dot" aria-hidden="true" />
        CLI connected
      </div>
    </aside>
  );
}
