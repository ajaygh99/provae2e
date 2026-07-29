import { useWorkspace } from '../workspace/WorkspaceContext';

/** Browses the server-filtered test definitions in the selected workspace. */
export function TestFileExplorer(): React.JSX.Element {
  const {
    workspace,
    files,
    filesLoading,
    filesError,
    selectedFile,
    selectFile,
    refreshFiles
  } = useWorkspace();

  if (!workspace) {
    return (
      <aside className="panel file-explorer" aria-labelledby="file-explorer-title">
        <h2 id="file-explorer-title">Test files</h2>
        <p>Select a workspace in Settings to browse test definitions.</p>
      </aside>
    );
  }

  return (
    <aside className="panel file-explorer" aria-labelledby="file-explorer-title">
      <div className="file-explorer__heading">
        <div>
          <span className="eyebrow">{workspace.name}</span>
          <h2 id="file-explorer-title">Test files</h2>
        </div>
        <button className="ui-button ui-button--secondary" type="button" onClick={() => void refreshFiles()}>
          Refresh
        </button>
      </div>
      {filesLoading && <p role="status">Discovering test files…</p>}
      {filesError && <p className="ui-field__error" role="alert">{filesError}</p>}
      {!filesLoading && !filesError && files.length === 0 && (
        <p>No `.prova`, `.provae2e`, `.test`, or `.spec` YAML/JSON files were found.</p>
      )}
      {files.length > 0 && (
        <ul className="file-explorer__list" aria-label="Workspace test files">
          {files.map(file => (
            <li key={file.id}>
              <button
                type="button"
                className={selectedFile?.id === file.id ? 'file-item file-item--selected' : 'file-item'}
                aria-pressed={selectedFile?.id === file.id}
                onClick={() => void selectFile(file.id)}
              >
                <strong>{file.name}</strong>
                <span>{file.relativePath}</span>
                <small>{file.format.toUpperCase()}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
