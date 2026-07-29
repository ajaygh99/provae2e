import { useState } from 'react';
import type { StudioTestDocument } from '../api/studio-api';
import { useWorkspace } from '../workspace/WorkspaceContext';

/** Plain-text YAML/JSON editor with explicit revision-aware saving. */
export function TestDocumentEditor(): React.JSX.Element {
  const {
    selectedFile,
    document,
    documentLoading,
    documentSaving,
    documentError,
    saveDocument
  } = useWorkspace();
  if (!selectedFile) {
    return <section className="panel test-editor"><h2>Editor</h2><p>Select a test file to edit it.</p></section>;
  }

  return (
    <section className="panel test-editor" aria-labelledby="test-editor-title">
      <div className="test-editor__heading">
        <div>
          <span className="eyebrow">{selectedFile.format.toUpperCase()}</span>
          <h2 id="test-editor-title">{selectedFile.name}</h2>
          <p>{selectedFile.relativePath}</p>
        </div>
      </div>
      {documentLoading && <p role="status">Loading document…</p>}
      {documentError && <p className="ui-field__error" role="alert">{documentError}</p>}
      {document && (
        <LoadedDocumentEditor
          key={document.id}
          document={document}
          documentLoading={documentLoading}
          documentSaving={documentSaving}
          saveDocument={saveDocument}
        />
      )}
    </section>
  );
}

interface LoadedDocumentEditorProps {
  document: StudioTestDocument;
  documentLoading: boolean;
  documentSaving: boolean;
  saveDocument: (content: string) => Promise<boolean>;
}

function LoadedDocumentEditor({
  document,
  documentLoading,
  documentSaving,
  saveDocument
}: LoadedDocumentEditorProps): React.JSX.Element {
  const [content, setContent] = useState(document.content);
  const [saved, setSaved] = useState(false);

  return (
    <>
      <label className="sr-only" htmlFor="studio-test-editor">Test definition</label>
      <textarea
        id="studio-test-editor"
        className="test-editor__input"
        value={content}
        spellCheck={false}
        onChange={event => {
          setContent(event.target.value);
          setSaved(false);
        }}
      />
      <div className="test-editor__status" aria-live="polite">
        <span>{content === document.content ? 'No unsaved changes' : 'Unsaved changes'}</span>
        {saved && <strong>Saved</strong>}
      </div>
      <button
        className="ui-button ui-button--primary"
        type="button"
        disabled={documentLoading || documentSaving || content === document.content}
        onClick={() => {
          void saveDocument(content).then(setSaved);
        }}
      >
        {documentSaving ? 'Saving…' : 'Save'}
      </button>
    </>
  );
}
