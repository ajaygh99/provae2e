import { useState } from 'react';
import { useWorkspace } from '../workspace/WorkspaceContext';

/** Selects one explicit local project directory through the Studio service. */
export function WorkspaceSelector(): React.JSX.Element {
  const { workspace, selecting, error, selectWorkspace } = useWorkspace();
  const [path, setPath] = useState('');

  return (
    <section className="panel workspace-selector" aria-labelledby="workspace-title">
      <div>
        <span className="eyebrow">Local workspace</span>
        <h2 id="workspace-title">Choose a test project</h2>
        <p>The local service validates this directory. Absolute paths are never returned to the browser.</p>
      </div>
      <form onSubmit={event => {
        event.preventDefault();
        void selectWorkspace(path);
      }}>
        <label className="ui-field" htmlFor="workspace-path">
          <span className="ui-field__label">Project directory</span>
          <input
            id="workspace-path"
            className="ui-input"
            value={path}
            onChange={event => setPath(event.target.value)}
            placeholder="C:\projects\my-tests"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="ui-button ui-button--primary" type="submit" disabled={selecting}>
          {selecting ? 'Selecting…' : 'Select workspace'}
        </button>
      </form>
      {error && <p className="ui-field__error" role="alert">{error}</p>}
      {workspace && (
        <p className="workspace-selector__selected" role="status">
          Selected <strong>{workspace.name}</strong> · {workspace.testFileCount} test files
        </p>
      )}
    </section>
  );
}

