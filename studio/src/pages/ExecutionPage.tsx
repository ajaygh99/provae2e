import { loadExecutionResult } from '../browser-test-store';

/** Displays the placeholder boundary for execution monitoring. */
export function ExecutionPage(): React.JSX.Element {
  const result = loadExecutionResult();
  return <section><span className="eyebrow">Run</span><h1>Executions</h1><p>Track active and completed PROVA test runs.</p>{result && <article className="panel execution-result"><div><h2>{result.testName}</h2><span className={`execution-status execution-status--${result.status.toLowerCase()}`}>{result.status}</span></div><p>{result.details}</p><small>Executed {new Date(result.executedAt).toLocaleString()}</small></article>}</section>;
}
