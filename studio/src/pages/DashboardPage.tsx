import { Link } from '../router';

const metrics = [
  ['Tests', '24'],
  ['Passing', '96%'],
  ['Runs today', '18']
] as const;

/** Displays the initial Studio overview. */
export function DashboardPage(): React.JSX.Element {
  return (
    <section aria-labelledby="dashboard-title">
      <div className="page-heading">
        <div><span className="eyebrow">Overview</span><h1 id="dashboard-title">Quality at a glance</h1></div>
        <Link className="primary-action" to="/builder">Create test</Link>
      </div>
      <div className="metric-grid">
        {metrics.map(([label, value]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>
      <article className="panel"><h2>Recent activity</h2><p>Your test activity will appear here as the Studio connects to PROVA CLI.</p></article>
    </section>
  );
}
