import { useMemo, useState } from 'react';
import { HttpStudioRunApi, type StudioRunApi, type StudioRunStatus } from '../api/studio-run-api';
import { useWorkspace } from '../workspace/WorkspaceContext';

export function StudioRunConsole({ api }: { api?: StudioRunApi }): React.JSX.Element {
  const resolvedApi = useMemo(() => api ?? new HttpStudioRunApi(), [api]);
  const { workspace, selectedFile } = useWorkspace();
  const [browser, setBrowser] = useState('chromium');
  const [status, setStatus] = useState<StudioRunStatus>();
  const [runId, setRunId] = useState('');
  const [lines, setLines] = useState<{ type: 'stdout' | 'stderr'; text: string }[]>([]);
  const [error, setError] = useState('');

  const run = async (): Promise<void> => {
    if (!workspace || !selectedFile) return;
    setLines([]);
    setError('');
    try {
      const summary = await resolvedApi.startRun(workspace.id, selectedFile.id, browser, 120_000);
      setRunId(summary.id);
      setStatus(summary.status);
      resolvedApi.streamEvents(summary.id, event => {
        if (event.type === 'stdout' || event.type === 'stderr') {
          setLines(current => [...current, { type: event.type, text: event.text }]);
        } else if (event.type === 'status') {
          setStatus(event.status);
        } else if (event.type === 'complete') {
          setStatus(event.summary.status);
        }
      }, () => setError('Live output connection was interrupted.'));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Run could not start.');
    }
  };

  return (
    <section className="panel run-console" aria-labelledby="run-console-title">
      <div className="test-editor__heading">
        <div><span className="eyebrow">Execute</span><h2 id="run-console-title">Live run</h2></div>
        <label><span>Browser</span><select value={browser} onChange={event => setBrowser(event.target.value)}>
          <option value="chromium">Chromium</option><option value="firefox">Firefox</option>
          <option value="webkit">WebKit</option><option value="all">All browsers</option>
        </select></label>
        <button className="ui-button ui-button--primary" type="button" disabled={!selectedFile || status === 'running' || status === 'queued'} onClick={() => void run()}>
          {status === 'running' || status === 'queued' ? 'Running…' : 'Run test'}
        </button>
        {(status === 'running' || status === 'queued') && (
          <button className="ui-button" type="button" onClick={() => {
            void resolvedApi.cancelRun(runId).then(summary => setStatus(summary.status)).catch(cancelError => {
              setError(cancelError instanceof Error ? cancelError.message : 'Run could not be cancelled.');
            });
          }}>Cancel run</button>
        )}
      </div>
      {status && <p role="status">Run status: <strong>{status}</strong></p>}
      {error && <p role="alert" className="ui-field__error">{error}</p>}
      <pre className="run-console__output" aria-label="Live command output" aria-live="polite">
        {lines.length ? lines.map((line, index) => <span className={`run-console__${line.type}`} key={index}>{line.text}</span>) : 'Output will appear here.'}
      </pre>
    </section>
  );
}
