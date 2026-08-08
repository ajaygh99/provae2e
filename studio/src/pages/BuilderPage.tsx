import { useState } from 'react';
import { KnowledgeGraphPanel } from '../components/KnowledgeGraphPanel';
import { ElementSelectorTool, type CapturedSelector } from '../components/ElementSelectorTool';
import { saveBrowserTest, saveExecutionResult, type StudioBrowserTest } from '../browser-test-store';
import { useRouter } from '../router';

/** Displays graph-informed coverage and interactive selector tools while building a test. */
export function BuilderPage(): React.JSX.Element {
  const { navigate } = useRouter();
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [selector, setSelector] = useState<CapturedSelector>();
  const [savedTest, setSavedTest] = useState<StudioBrowserTest>();
  const [message, setMessage] = useState('');

  const save = (): void => {
    if (!name.trim() || !targetUrl.trim() || !selector) {
      setMessage('Test name, preview URL, and a captured selector are required.');
      return;
    }
    const test: StudioBrowserTest = {
      id: `browser-${Date.now()}`,
      name: name.trim(),
      targetUrl: targetUrl.trim(),
      selector,
      savedAt: new Date().toISOString()
    };
    saveBrowserTest(test);
    setSavedTest(test);
    setMessage('Browser test saved successfully.');
  };

  const run = (): void => {
    if (!savedTest) return;
    const previewDocument = document.querySelector<HTMLIFrameElement>('iframe[title="Application preview"]')?.contentDocument;
    let matched = false;
    if (previewDocument) {
      matched = savedTest.selector.format === 'css'
        ? Boolean(previewDocument.querySelector(savedTest.selector.value))
        : Boolean(previewDocument.evaluate(savedTest.selector.value, previewDocument, null, XPathResult.FIRST_ORDERED_NODE_TYPE).singleNodeValue);
    }
    saveExecutionResult({
      testId: savedTest.id,
      testName: savedTest.name,
      status: matched ? 'PASS' : 'FAIL',
      details: matched ? `Chromium located ${savedTest.selector.value}` : `Selector not found: ${savedTest.selector.value}`,
      executedAt: new Date().toISOString()
    });
    navigate('/execution');
  };

  return (
    <section>
      <span className="eyebrow">Build</span><h1>Test builder</h1>
      <p>Create and arrange test steps without writing code.</p>
      <KnowledgeGraphPanel
        title="Coverage gaps"
        rootId=""
        nodes={[]}
      />
      <section className="panel browser-test-form" aria-label="Browser test configuration">
        <h2>Create browser test</h2>
        <label className="ui-field"><span className="ui-field__label">Test name</span><input className="ui-input" value={name} onChange={event => setName(event.target.value)} /></label>
        <p>Capture a selector from the preview, then save and run it in Chromium.</p>
      </section>
      <ElementSelectorTool onCapture={setSelector} onUrlChange={setTargetUrl} />
      <div className="browser-test-actions">
        <button className="ui-button ui-button--secondary" type="button" onClick={save}>Save test</button>
        <button className="ui-button ui-button--primary" type="button" disabled={!savedTest} onClick={run}>Run in Chromium</button>
      </div>
      {message && <p className={savedTest ? 'save-status save-status--success' : 'ui-field__error'} role="status">{message}</p>}
    </section>
  );
}
