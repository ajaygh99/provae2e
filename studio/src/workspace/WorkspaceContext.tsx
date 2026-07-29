import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  HttpStudioApi,
  type StudioApi,
  type StudioTestDocument,
  type StudioTestFile,
  type StudioWorkspace
} from '../api/studio-api';

interface WorkspaceValue {
  workspace?: StudioWorkspace;
  selecting: boolean;
  error: string;
  files: readonly StudioTestFile[];
  filesLoading: boolean;
  filesError: string;
  selectedFile?: StudioTestFile;
  document?: StudioTestDocument;
  documentLoading: boolean;
  documentSaving: boolean;
  documentError: string;
  selectWorkspace: (path: string) => Promise<void>;
  selectFile: (fileId: string) => Promise<void>;
  saveDocument: (content: string) => Promise<boolean>;
  refreshFiles: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | undefined>(undefined);

export interface WorkspaceProviderProps {
  children: React.ReactNode;
  api?: StudioApi;
}

/** Owns the browser-safe selected workspace state for the Studio session. */
export function WorkspaceProvider({ children, api }: WorkspaceProviderProps): React.JSX.Element {
  const resolvedApi = useMemo(() => api ?? new HttpStudioApi(), [api]);
  const [workspace, setWorkspace] = useState<StudioWorkspace>();
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<readonly StudioTestFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [selectedFile, setSelectedFile] = useState<StudioTestFile>();
  const [document, setDocument] = useState<StudioTestDocument>();
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [documentError, setDocumentError] = useState('');

  const loadFiles = useCallback(async (selectedWorkspace: StudioWorkspace): Promise<void> => {
    setFilesLoading(true);
    setFilesError('');
    try {
      const discovered = await resolvedApi.listFiles(selectedWorkspace.id);
      setFiles(discovered);
      setSelectedFile(current => discovered.find(file => file.id === current?.id));
      if (selectedFile && !discovered.some(file => file.id === selectedFile.id)) {
        setDocument(undefined);
      }
    } catch (fileError) {
      setFiles([]);
      setFilesError(fileError instanceof Error ? fileError.message : 'Test-file discovery failed.');
    } finally {
      setFilesLoading(false);
    }
  }, [resolvedApi, selectedFile]);

  const value = useMemo<WorkspaceValue>(() => ({
    workspace,
    selecting,
    error,
    files,
    filesLoading,
    filesError,
    selectedFile,
    document,
    documentLoading,
    documentSaving,
    documentError,
    selectWorkspace: async (path: string) => {
      const trimmedPath = path.trim();
      if (!trimmedPath) {
        setError('Enter a workspace directory.');
        return;
      }
      setSelecting(true);
      setError('');
      try {
        const selected = await resolvedApi.selectWorkspace(trimmedPath);
        setWorkspace(selected);
        setSelectedFile(undefined);
        setDocument(undefined);
        await loadFiles(selected);
      } catch (selectionError) {
        setError(selectionError instanceof Error ? selectionError.message : 'Workspace selection failed.');
      } finally {
        setSelecting(false);
      }
    },
    selectFile: async (fileId: string) => {
      const file = files.find(candidate => candidate.id === fileId);
      setSelectedFile(file);
      setDocument(undefined);
      setDocumentError('');
      if (!file) return;
      setDocumentLoading(true);
      try {
        setDocument(await resolvedApi.readDocument(file.workspaceId, file.id));
      } catch (readError) {
        setDocumentError(readError instanceof Error ? readError.message : 'Test document could not be loaded.');
      } finally {
        setDocumentLoading(false);
      }
    },
    saveDocument: async (content: string) => {
      if (!document) return false;
      setDocumentSaving(true);
      setDocumentError('');
      try {
        setDocument(await resolvedApi.saveDocument(
          document.workspaceId,
          document.id,
          content,
          document.revision
        ));
        return true;
      } catch (saveError) {
        setDocumentError(saveError instanceof Error ? saveError.message : 'Test document could not be saved.');
        return false;
      } finally {
        setDocumentSaving(false);
      }
    },
    refreshFiles: async () => {
      if (workspace) await loadFiles(workspace);
    }
  }), [
    document,
    documentError,
    documentLoading,
    documentSaving,
    error,
    files,
    filesError,
    filesLoading,
    loadFiles,
    resolvedApi,
    selectedFile,
    selecting,
    workspace
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is required.');
  return value;
}
