import { createContext, useContext, useMemo, useState } from 'react';
import { HttpStudioApi, type StudioApi, type StudioWorkspace } from '../api/studio-api';

interface WorkspaceValue {
  workspace?: StudioWorkspace;
  selecting: boolean;
  error: string;
  selectWorkspace(path: string): Promise<void>;
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

  const value = useMemo<WorkspaceValue>(() => ({
    workspace,
    selecting,
    error,
    selectWorkspace: async (path: string) => {
      const trimmedPath = path.trim();
      if (!trimmedPath) {
        setError('Enter a workspace directory.');
        return;
      }
      setSelecting(true);
      setError('');
      try {
        setWorkspace(await resolvedApi.selectWorkspace(trimmedPath));
      } catch (selectionError) {
        setError(selectionError instanceof Error ? selectionError.message : 'Workspace selection failed.');
      } finally {
        setSelecting(false);
      }
    }
  }), [error, resolvedApi, selecting, workspace]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is required.');
  return value;
}

