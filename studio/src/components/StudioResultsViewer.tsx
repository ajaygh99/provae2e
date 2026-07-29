import { useEffect, useMemo, useState } from 'react';
import { HttpStudioRunApi, type StudioRunApi, type StudioRunSummary } from '../api/studio-run-api';

export function StudioResultsViewer({ api }: { api?: StudioRunApi }): React.JSX.Element {
  const resolvedApi = useMemo(() => api ?? new HttpStudioRunApi(), [api]);
  const [runs, setRuns] = useState<readonly StudioRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      setRuns(await resolvedApi.listRuns());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Run history could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [resolvedApi]);

  return (
    <section className="panel results-viewer" aria-labelledby="results-viewer-title">
      <div className="test-editor__heading">
        <div><span className="eyebrow">History</span><h2 id="results-viewer-title">Run results</h2></div>
        <button className="ui-button" type="button" disabled={loading} onClick={() => void refresh()}>Refresh results</button>
      </div>
      {loading && <p role="status">Loading run results…</p>}
      {error && <p role="alert" className="ui-field__error">{error}</p>}
      {!loading && !error && runs.length === 0 && <p>No runs yet. Select a test and start your first run.</p>}
      {runs.length > 0 && (
        <ol className="results-viewer__list">
          {runs.map(run => (
            <li key={run.id}>
              <article className="result-card">
                <div><strong>{run.status}</strong><code>{run.id}</code></div>
                <dl>
                  <div><dt>Duration</dt><dd>{run.durationMs === undefined ? 'In progress' : `${run.durationMs} ms`}</dd></div>
                  <div><dt>Test</dt><dd>{run.fileId}</dd></div>
                </dl>
                {run.failureSummary && <p className="ui-field__error">Failure: {run.failureSummary}</p>}
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
