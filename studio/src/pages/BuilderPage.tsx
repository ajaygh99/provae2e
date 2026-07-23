import { KnowledgeGraphPanel } from '../components/KnowledgeGraphPanel';

/** Displays graph-informed coverage suggestions while building a test. */
export function BuilderPage(): React.JSX.Element {
  return (
    <section>
      <span className="eyebrow">Build</span><h1>Test builder</h1>
      <p>Create and arrange test steps without writing code.</p>
      <KnowledgeGraphPanel
        title="Coverage gaps"
        rootId=""
        nodes={[]}
      />
    </section>
  );
}
