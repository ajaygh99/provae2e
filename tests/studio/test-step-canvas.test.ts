import { TestStepCanvas, type StudioTestStep } from '../../src/studio/test-step-canvas.js';

const initial: StudioTestStep[] = [
  { id: 'one', action: 'navigate', label: 'Open login', target: '/login' },
  { id: 'two', action: 'fill', label: 'Enter email', target: '#email', value: 'user@example.com' },
  { id: 'three', action: 'click', label: 'Submit', target: '#submit' }
];

describe('TestStepCanvas', () => {
  it('loads initial ordered steps without exposing mutable state', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    const snapshot = canvas.getSnapshot();
    expect(snapshot.steps.map((step) => step.id)).toEqual(['one', 'two', 'three']);
    expect(Object.isFrozen(snapshot.steps[0])).toBe(true);
    initial[0].label = 'changed externally';
    expect(canvas.getSnapshot().steps[0].label).toBe('Open login');
  });

  it('adds a generated step at the end', () => {
    const canvas = new TestStepCanvas({ idFactory: (): string => 'new-id' });
    expect(canvas.addStep({ action: 'assert', label: 'See dashboard' })).toBe('new-id');
    expect(canvas.getSnapshot().steps[0]).toMatchObject({ id: 'new-id', action: 'assert' });
  });

  it('inserts a step at a chosen position', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial, idFactory: (): string => 'middle' });
    canvas.addStep({ action: 'wait', label: 'Wait' }, 1);
    expect(canvas.getSnapshot().steps.map((step) => step.id)).toEqual(['one', 'middle', 'two', 'three']);
  });

  it('rejects an invalid insertion position', () => {
    const canvas = new TestStepCanvas();
    expect(() => canvas.addStep({ action: 'wait', label: 'Wait' }, 1)).toThrow('Insertion index');
  });

  it('enforces maximum canvas size', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial.slice(0, 1), maximumSteps: 1 });
    expect(() => canvas.addStep({ action: 'wait', label: 'Wait' })).toThrow('more than 1');
    expect(() => new TestStepCanvas({ maximumSteps: 0 })).toThrow('maximumSteps');
  });

  it('rejects duplicate and invalid initial steps', () => {
    expect(() => new TestStepCanvas({ initialSteps: [initial[0], initial[0]] })).toThrow('Duplicate');
    expect(() => new TestStepCanvas({
      initialSteps: [{ id: '', action: 'wait', label: 'Wait' }]
    })).toThrow('id');
    expect(() => new TestStepCanvas({
      initialSteps: [{ id: 'bad', action: 'wait', label: '', timeoutMs: 0 }]
    })).toThrow('label');
  });

  it('updates an existing step', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    canvas.updateStep('two', { label: 'Enter username', timeoutMs: 2_000 });
    expect(canvas.getSnapshot().steps[1]).toMatchObject({ label: 'Enter username', timeoutMs: 2_000 });
  });

  it('validates timeout updates', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    expect(() => canvas.updateStep('two', { timeoutMs: -1 })).toThrow('positive integer');
  });

  it('removes and returns a step', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    expect(canvas.removeStep('two').id).toBe('two');
    expect(canvas.getSnapshot().steps.map((step) => step.id)).toEqual(['one', 'three']);
  });

  it('reports unknown step identifiers clearly', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    expect(() => canvas.removeStep('missing')).toThrow('Test step not found');
    expect(() => canvas.updateStep('missing', {})).toThrow('Test step not found');
  });

  it('reorders steps directly', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    canvas.reorderStep(2, 0);
    expect(canvas.getSnapshot().steps.map((step) => step.id)).toEqual(['three', 'one', 'two']);
  });

  it('does not revise state for a no-op reorder', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    canvas.reorderStep(1, 1);
    expect(canvas.getSnapshot().revision).toBe(0);
  });

  it('rejects out-of-range reorder positions', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    expect(() => canvas.reorderStep(-1, 1)).toThrow('out of range');
    expect(() => canvas.reorderStep(0, 3)).toThrow('out of range');
  });

  it('applies a react-beautiful-dnd-compatible drop result', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    const result = canvas.applyDrop({
      draggableId: 'one',
      source: { droppableId: 'prova-test-step-canvas', index: 0 },
      destination: { droppableId: 'prova-test-step-canvas', index: 2 }
    });
    expect(result.changed).toBe(true);
    expect(result.snapshot.steps.map((step) => step.id)).toEqual(['two', 'three', 'one']);
  });

  it('ignores drops outside the canvas', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    expect(canvas.applyDrop({
      draggableId: 'one',
      source: { droppableId: 'prova-test-step-canvas', index: 0 },
      destination: null
    })).toMatchObject({ changed: false, reason: 'outside-canvas' });
  });

  it('ignores drops from another canvas', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    expect(canvas.applyDrop({
      draggableId: 'one',
      source: { droppableId: 'another', index: 0 },
      destination: { droppableId: 'prova-test-step-canvas', index: 1 }
    })).toMatchObject({ changed: false, reason: 'different-canvas' });
  });

  it('detects stale draggable identifiers', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    expect(() => canvas.applyDrop({
      draggableId: 'two',
      source: { droppableId: 'prova-test-step-canvas', index: 0 },
      destination: { droppableId: 'prova-test-step-canvas', index: 1 }
    })).toThrow('does not match');
  });

  it('supports keyboard-accessible reordering', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    canvas.selectStep('two');
    expect(canvas.moveSelected('up')).toBe(true);
    expect(canvas.getSnapshot().steps.map((step) => step.id)).toEqual(['two', 'one', 'three']);
    expect(canvas.moveSelected('up')).toBe(false);
    expect(canvas.moveSelected('down')).toBe(true);
  });

  it('clears selection when the selected step is removed', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    canvas.selectStep('two');
    canvas.removeStep('two');
    expect(canvas.getSnapshot().selectedStepId).toBeUndefined();
  });

  it('notifies subscribers only for successful changes', () => {
    const canvas = new TestStepCanvas({ initialSteps: initial });
    const listener = jest.fn();
    const unsubscribe = canvas.subscribe(listener);
    canvas.selectStep('one');
    canvas.selectStep('one');
    unsubscribe();
    canvas.removeStep('one');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].revision).toBe(1);
  });

  it('round trips ordered steps through JSON', () => {
    const restored = TestStepCanvas.fromJSON(new TestStepCanvas({ initialSteps: initial }).toJSON());
    expect(restored.getSnapshot().steps).toEqual(initial);
  });

  it('rejects malformed canvas JSON', () => {
    expect(() => TestStepCanvas.fromJSON('{oops')).toThrow('Invalid canvas JSON');
    expect(() => TestStepCanvas.fromJSON('{}')).toThrow('array of steps');
  });
});
