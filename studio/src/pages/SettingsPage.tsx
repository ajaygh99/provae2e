import { WorkspaceSelector } from '../components/WorkspaceSelector';

/** Displays local workspace and CLI connection settings. */
export function SettingsPage(): React.JSX.Element {
  return (
    <section>
      <span className="eyebrow">Configure</span>
      <h1>Settings</h1>
      <p>Manage your Studio workspace and CLI connection.</p>
      <WorkspaceSelector />
    </section>
  );
}
