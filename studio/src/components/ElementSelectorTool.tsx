import { useEffect, useRef, useState } from 'react';
import { createCssSelector, createXPath } from './selector-utils';

export type SelectorFormat = 'css' | 'xpath';

export interface CapturedSelector {
  format: SelectorFormat;
  value: string;
  tagName: string;
  text: string;
}

interface ElementSelectorToolProps {
  targetDocument?: Document;
  onCapture?: (selector: CapturedSelector) => void;
  onUrlChange?: (url: string) => void;
}

const safePreviewUrl = (value: string): string => {
  if (!value) return 'about:blank';
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
      ? parsedUrl.href
      : 'about:blank';
  } catch {
    return 'about:blank';
  }
};

/** Interactive Studio element selector for embedded, same-origin application previews. */
export function ElementSelectorTool({
  targetDocument,
  onCapture,
  onUrlChange
}: ElementSelectorToolProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<SelectorFormat>('css');
  const [active, setActive] = useState(false);
  const [captured, setCaptured] = useState<CapturedSelector>();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    let documentToInspect: Document;
    try {
      documentToInspect = targetDocument ?? iframeRef.current?.contentDocument as Document;
      if (!documentToInspect) throw new Error('Load a page before selecting an element.');
      void documentToInspect.body;
    } catch {
      setError('This page cannot be inspected. Use a same-origin Studio preview.');
      setActive(false);
      return undefined;
    }
    const highlightStyle = documentToInspect.createElement('style');
    highlightStyle.dataset.provaSelectorHighlight = 'true';
    highlightStyle.textContent = `
      .prova-selector-highlight {
        outline: 3px solid #7c3aed !important;
        outline-offset: 2px !important;
        cursor: crosshair !important;
      }
    `;
    documentToInspect.head?.append(highlightStyle);

    const isInspectableElement = (value: EventTarget | null): value is HTMLElement => {
      const ElementConstructor = documentToInspect.defaultView?.HTMLElement;
      return ElementConstructor
        ? value instanceof ElementConstructor
        : value instanceof HTMLElement;
    };

    let highlighted: HTMLElement | undefined;
    const highlight = (event: MouseEvent): void => {
      const element = event.target;
      if (!isInspectableElement(element) || element.closest('[data-selector-tool]')) return;
      highlighted?.classList.remove('prova-selector-highlight');
      highlighted = element;
      highlighted.classList.add('prova-selector-highlight');
    };
    const select = (event: MouseEvent): void => {
      const element = event.target;
      if (!isInspectableElement(element) || element.closest('[data-selector-tool]')) return;
      event.preventDefault();
      event.stopPropagation();
      const value = format === 'css' ? createCssSelector(element) : createXPath(element);
      const result: CapturedSelector = {
        format,
        value,
        tagName: element.tagName.toLowerCase(),
        text: (element.textContent ?? '').trim().slice(0, 100)
      };
      setCaptured(result);
      setActive(false);
      setCopied(false);
      onCapture?.(result);
    };
    documentToInspect.addEventListener('mouseover', highlight, true);
    documentToInspect.addEventListener('click', select, true);
    return () => {
      documentToInspect.removeEventListener('mouseover', highlight, true);
      documentToInspect.removeEventListener('click', select, true);
      highlighted?.classList.remove('prova-selector-highlight');
      highlightStyle.remove();
    };
  }, [active, format, onCapture, targetDocument]);

  const copyWithFallback = (value: string): boolean => {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const succeeded = document.execCommand?.('copy') ?? false;
    textarea.remove();
    return succeeded;
  };

  const copy = async (): Promise<void> => {
    if (!captured) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(captured.value);
      } else if (!copyWithFallback(captured.value)) {
        throw new Error('Clipboard API is unavailable.');
      }
      setCopied(true);
      setError('');
    } catch {
      if (copyWithFallback(captured.value)) {
        setCopied(true);
        setError('');
      } else {
        setError('Clipboard access was denied. Select and copy the value manually.');
      }
    }
  };

  return (
    <section className="selector-tool panel" data-selector-tool>
      <div className="selector-tool__heading">
        <div>
          <span className="eyebrow">Element selector</span>
          <h2>Pick from a live page</h2>
        </div>
        <span className={active ? 'selector-status selector-status--active' : 'selector-status'}>
          {active ? 'Picking' : 'Ready'}
        </span>
      </div>
      <div className="selector-toolbar">
        <label className="ui-field">
          <span className="ui-field__label">Preview URL</span>
          <input
            className="ui-input"
            type="url"
            placeholder="http://localhost:3000"
            value={url}
            onChange={event => {
              setUrl(event.target.value);
              onUrlChange?.(event.target.value);
            }}
          />
        </label>
        <label className="ui-field">
          <span className="ui-field__label">Selector type</span>
          <select className="ui-input ui-select" value={format} onChange={event => setFormat(event.target.value as SelectorFormat)}>
            <option value="css">CSS selector</option>
            <option value="xpath">XPath</option>
          </select>
        </label>
        <button className="ui-button ui-button--primary" type="button" onClick={() => {
          setError('');
          setActive(value => !value);
        }}>
          {active ? 'Cancel picking' : 'Pick element'}
        </button>
      </div>
      {!targetDocument && (
        <iframe
          ref={iframeRef}
          className="selector-preview"
          title="Application preview"
          src={safePreviewUrl(url)}
          onLoad={() => setError('')}
        />
      )}
      {active && <p className="selector-instructions" role="status">Hover to highlight, then click an element to capture its selector.</p>}
      {error && <p className="ui-field__error" role="alert">{error}</p>}
      {captured && (
        <div className="selector-result">
          <div>
            <span className="eyebrow">{captured.format} · {captured.tagName}</span>
            <code tabIndex={0}>{captured.value}</code>
            {captured.text && <small>{captured.text}</small>}
          </div>
          <button className="ui-button ui-button--secondary" type="button" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </section>
  );
}
