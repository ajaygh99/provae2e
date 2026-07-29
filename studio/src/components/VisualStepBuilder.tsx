import { parse, stringify } from 'yaml';
import { useWorkspace } from '../workspace/WorkspaceContext';

interface Step {
  action: string;
  selector?: string;
  value?: string;
  expected?: string;
}

interface Definition {
  name?: string;
  url?: string;
  steps?: Step[];
}

const actionOptions = ['navigate', 'click', 'fill', 'assert', 'wait'];

/** Structured editing surface that updates the same draft as the source editor. */
export function VisualStepBuilder(): React.JSX.Element {
  const { document, draftContent, updateDraft } = useWorkspace();
  if (!document) {
    return <section className="panel"><h2>Visual steps</h2><p>Select a valid test definition to build steps.</p></section>;
  }

  const definition = readDefinition(draftContent, document.format);
  if (!definition || !Array.isArray(definition.steps)) {
    return <section className="panel"><h2>Visual steps</h2><p>Fix source validation errors to use the visual builder.</p></section>;
  }

  const commit = (steps: Step[]): void => {
    updateDraft(writeDefinition({ ...definition, steps }, document.format));
  };

  return (
    <section className="panel visual-steps" aria-labelledby="visual-steps-title">
      <div className="test-editor__heading">
        <div><span className="eyebrow">No-code</span><h2 id="visual-steps-title">Visual steps</h2></div>
        <button className="ui-button" type="button" onClick={() => commit([...definition.steps!, { action: 'wait' }])}>
          Add step
        </button>
      </div>
      <ol>
        {definition.steps.map((step, index) => (
          <li key={index} className="visual-step">
            <label>
              <span>Action {index + 1}</span>
              <select
                value={step.action}
                onChange={event => {
                  const next = [...definition.steps!];
                  next[index] = { action: event.target.value };
                  commit(next);
                }}
              >
                {actionOptions.map(action => <option key={action}>{action}</option>)}
              </select>
            </label>
            {['click', 'fill', 'assert'].includes(step.action) && (
              <label><span>Selector</span><input value={step.selector ?? ''} onChange={event => {
                const next = [...definition.steps!];
                next[index] = { ...step, selector: event.target.value };
                commit(next);
              }} /></label>
            )}
            {step.action === 'fill' && (
              <label><span>Value</span><input value={step.value ?? ''} onChange={event => {
                const next = [...definition.steps!];
                next[index] = { ...step, value: event.target.value };
                commit(next);
              }} /></label>
            )}
            <div className="visual-step__actions">
              <button type="button" disabled={index === 0} onClick={() => commit(move(definition.steps!, index, index - 1))}>Move up</button>
              <button type="button" disabled={index === definition.steps!.length - 1} onClick={() => commit(move(definition.steps!, index, index + 1))}>Move down</button>
              <button type="button" onClick={() => commit(definition.steps!.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function readDefinition(content: string, format: 'yaml' | 'json'): Definition | undefined {
  try {
    const value = format === 'json' ? JSON.parse(content) : parse(content);
    return typeof value === 'object' && value !== null ? value as Definition : undefined;
  } catch {
    return undefined;
  }
}

function writeDefinition(value: Definition, format: 'yaml' | 'json'): string {
  return format === 'json' ? `${JSON.stringify(value, null, 2)}\n` : stringify(value);
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
