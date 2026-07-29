import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  HttpStudioApi,
  type StudioApi,
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
  selectWorkspace: (path: string) => Promise<void>;
  selectFile: (fileId: string) => void;
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

  const loadFiles = useCallback(async (selectedWorkspace: StudioWorkspace): Promise<void> => {
    setFilesLoading(true);
    setFilesError('');
    try {
      const discovered = await resolvedApi.listFiles(selectedWorkspace.id);
      setFiles(discovered);
      setSelectedFile(current => discovered.find(file => file.id === current?.id));
    } catch (fileError) {
      setFiles([]);
      setFilesError(fileError instanceof Error ? fileError.message : 'Test-file discovery failed.');
    } finally {
      setFilesLoading(false);
    }
  }, [resolvedApi]);

  const value = useMemo<WorkspaceValue>(() => ({
    workspace,
    selecting,
    error,
    files,
    filesLoading,
    filesError,
    selectedFile,
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
        await loadFiles(selected);
      } catch (selectionError) {
        setError(selectionError instanceof Error ? selectionError.message : 'Workspace selection failed.');
      } finally {
        setSelecting(false);
      }
    },
    selectFile: (fileId: string) => {
      setSelectedFile(files.find(file => file.id === fileId));
    },
    refreshFiles: async () => {
      if (workspace) await loadFiles(workspace);
    }
  }), [error, files, filesError, filesLoading, loadFiles, resolvedApi, selectedFile, selecting, workspace]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is required.');
  return value;
}
