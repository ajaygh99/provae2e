/** Displays the current workspace and MVP user actions. */
export function Header(): React.JSX.Element {
  return (
    <header className="app-header">
      <div>
        <span className="eyebrow">Workspace</span>
        <strong>Beta Engineering</strong>
      </div>
      <div className="profile">
        <span className="avatar" aria-hidden="true">AJ</span>
        <span className="profile-name">Ajay</span>
        <button type="button" className="logout-button" aria-label="Log out of PROVA Studio">
          Log out
        </button>
      </div>
    </header>
  );
}
