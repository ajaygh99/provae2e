/** Builds a stable CSS selector for an element. */
export function createCssSelector(element: Element): string {
  const id = element.getAttribute('id');
  if (id) return `#${escapeCss(id)}`;
  const testId = element.getAttribute('data-testid');
  if (testId) return `[data-testid="${escapeAttribute(testId)}"]`;
  const name = element.getAttribute('name');
  if (name) return `${element.tagName.toLowerCase()}[name="${escapeAttribute(name)}"]`;
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current.tagName.toLowerCase() !== 'html') {
    let segment = current.tagName.toLowerCase();
    const classes = [...current.classList].filter(value => /^[a-zA-Z_-][\w-]*$/.test(value)).slice(0, 2);
    if (classes.length > 0) segment += classes.map(value => `.${escapeCss(value)}`).join('');
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(child => child.tagName === current?.tagName);
      if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    segments.unshift(segment);
    current = parent;
  }
  return segments.join(' > ');
}

/** Builds an absolute XPath for an element. */
export function createXPath(element: Element): string {
  const id = element.getAttribute('id');
  if (id) return `//*[@id=${xpathLiteral(id)}]`;
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      segments.unshift(tag);
      break;
    }
    const siblings = [...parent.children].filter(child => child.tagName === current?.tagName);
    const position = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : '';
    segments.unshift(`${tag}${position}`);
    current = parent;
  }
  return `/${segments.join('/')}`;
}

function escapeCss(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);
}
function escapeAttribute(value: string): string { return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}
