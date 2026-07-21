/** Deterministic acceptance-step to Playwright source mapping. */
import type { ParsedStep } from '../parsers/gherkin-parser.js';

function literal(value: string): string { return JSON.stringify(value); }
function selector(label: string): string {
  return `[data-testid=${JSON.stringify(label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}]`;
}

/** Maps one parsed step to safe Playwright TypeScript with TODOs for product-specific selectors. */
export function stepToPlaywright(step: ParsedStep, defaultUrl: string): string[] {
  const text = step.text;
  const quoted = [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (/\b(?:is on|visits?|navigates? to)\b/i.test(text) && /^https?:\/\//i.test(quoted[0] ?? '')) {
    return [`await page.goto(${literal(quoted[0])});`];
  }
  if (step.kind === 'given' && /\b(?:login|home|page)\b/i.test(text)) return [`await page.goto(${literal(defaultUrl)});`];
  if (/\b(?:enters?|fills?|types?)\b/i.test(text) && quoted.length) {
    const field = quoted[1] ?? 'field';
    return [`// TODO: confirm selector for ${field}`, `await page.locator(${literal(selector(field))}).fill(${literal(quoted[0])});`];
  }
  if (/\bclicks?\b/i.test(text)) {
    const label = quoted[0] ?? text.replace(/^.*?clicks?\s+/i, '').replace(/\s+button$/i, '');
    return [`await page.getByRole('button', { name: ${literal(label)} }).click();`];
  }
  if (/URL should contain/i.test(text) && quoted[0]) return [`await expect(page).toHaveURL(new RegExp(${literal(quoted[0])}));`];
  if (/\b(?:should see|displays?|visible)\b/i.test(text)) {
    const expected = quoted[0] ?? text.replace(/^.*?(?:should see|displays?)\s+/i, '');
    return [`await expect(page.getByText(${literal(expected)})).toBeVisible();`];
  }
  const wait = text.match(/wait\s+(\d+)\s+seconds?/i);
  if (wait) return [`await page.waitForTimeout(${Number(wait[1]) * 1000});`];
  return [`// TODO: implement ${step.kind}: ${text.replace(/\r?\n/g, ' ')}`];
}
