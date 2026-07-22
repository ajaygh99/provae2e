import { NavLink } from 'react-router-dom';

const navigation = [
  { to: '/dashboard', label: 'Dashboard', icon: 'D' },
  { to: '/builder', label: 'Test builder', icon: 'B' },
  { to: '/execution', label: 'Executions', icon: 'E' },
  { to: '/settings', label: 'Settings', icon: 'S' }
] as const;

/** Renders Studio's primary route navigation with active-state semantics. */
export function Sidebar(): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">P</span>
        <div><strong>PROVA</strong><span>Studio</span></div>
      </div>
      <nav aria-label="Primary navigation">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-status">
        <span className="status-dot" aria-hidden="true" />
        CLI connected
      </div>
    </aside>
  );
}
