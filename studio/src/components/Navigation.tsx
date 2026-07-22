import { NavLink } from 'react-router-dom';

const navigation = [
  { to: '/dashboard', label: 'Dashboard', icon: 'D' },
  { to: '/builder', label: 'Test builder', icon: 'B' },
  { to: '/execution', label: 'Executions', icon: 'E' },
  { to: '/settings', label: 'Settings', icon: 'S' }
] as const;

interface NavigationProps {
  onNavigate?: () => void;
}

/** Renders the main navigation list for Studio. */
export function Navigation({ onNavigate }: NavigationProps): React.JSX.Element {
  return (
    <nav aria-label="Primary navigation">
      {navigation.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          onClick={onNavigate}
        >
          <span className="nav-icon" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
