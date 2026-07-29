import { KnowledgeGraphPanel } from '../components/KnowledgeGraphPanel';
import { ElementSelectorTool } from '../components/ElementSelectorTool';
import { TestFileExplorer } from '../components/TestFileExplorer';
import { TestDocumentEditor } from '../components/TestDocumentEditor';
import { VisualStepBuilder } from '../components/VisualStepBuilder';
import { StudioRunConsole } from '../components/StudioRunConsole';
import { StudioResultsViewer } from '../components/StudioResultsViewer';

/** Displays graph-informed coverage and interactive selector tools while building a test. */
export function BuilderPage(): React.JSX.Element {
  return (
    <section>
      <span className="eyebrow">Build</span><h1>Test builder</h1>
      <p>Create and arrange test steps without writing code.</p>
      <div className="builder-workspace">
        <TestFileExplorer />
        <TestDocumentEditor />
      </div>
      <VisualStepBuilder />
      <StudioRunConsole />
      <StudioResultsViewer />
      <KnowledgeGraphPanel
        title="Coverage gaps"
        rootId=""
        nodes={[]}
      />
      <ElementSelectorTool />
    </section>
  );
}
