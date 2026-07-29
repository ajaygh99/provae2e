import { KnowledgeGraphPanel } from '../components/KnowledgeGraphPanel';
import { ElementSelectorTool } from '../components/ElementSelectorTool';
import { TestFileExplorer } from '../components/TestFileExplorer';

/** Displays graph-informed coverage and interactive selector tools while building a test. */
export function BuilderPage(): React.JSX.Element {
  return (
    <section>
      <span className="eyebrow">Build</span><h1>Test builder</h1>
      <p>Create and arrange test steps without writing code.</p>
      <TestFileExplorer />
      <KnowledgeGraphPanel
        title="Coverage gaps"
        rootId=""
        nodes={[]}
      />
      <ElementSelectorTool />
    </section>
  );
}
