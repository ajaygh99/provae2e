/** Lightweight multilingual Gherkin and bullet acceptance-criteria parser. */
export type AcceptanceLanguage = 'en' | 'es' | 'fr';
export type StepKind = 'given' | 'when' | 'then' | 'and';
export interface ParsedStep { kind: StepKind; text: string; }
export interface ParsedScenario { name: string; steps: ParsedStep[]; }
export interface ParsedFeature { name: string; scenarios: ParsedScenario[]; }

const WORDS: Record<AcceptanceLanguage, {
  feature: string[]; scenario: string[]; given: string[]; when: string[]; then: string[]; and: string[];
}> = {
  en: { feature: ['Feature'], scenario: ['Scenario'], given: ['Given'], when: ['When'], then: ['Then'], and: ['And', 'But'] },
  es: { feature: ['Característica', 'Funcionalidad'], scenario: ['Escenario'], given: ['Dado', 'Dada'], when: ['Cuando'], then: ['Entonces'], and: ['Y', 'Pero'] },
  fr: { feature: ['Fonctionnalité'], scenario: ['Scénario'], given: ['Étant donné', 'Etant donné'], when: ['Quand', 'Lorsque'], then: ['Alors'], and: ['Et', 'Mais'] }
};

function prefixed(line: string, words: string[]): string | undefined {
  for (const word of words) {
    const match = line.match(new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s+(.+)$`, 'i'));
    if (match) return match[1].trim();
  }
  return undefined;
}

/** Parses feature/scenario/step text and bullet criteria without executing code. */
export function parseGherkin(source: string, language: AcceptanceLanguage = 'en'): ParsedFeature {
  const words = WORDS[language];
  let name = 'Generated acceptance tests';
  const scenarios: ParsedScenario[] = [];
  let current: ParsedScenario | undefined;
  const ensureScenario = (): ParsedScenario => {
    current ??= { name: 'Acceptance criteria', steps: [] };
    if (!scenarios.includes(current)) scenarios.push(current);
    return current;
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const feature = prefixed(line, words.feature);
    if (feature) { name = feature; continue; }
    const scenario = prefixed(line, words.scenario);
    if (scenario) { current = { name: scenario, steps: [] }; scenarios.push(current); continue; }
    let matched = false;
    for (const kind of ['given', 'when', 'then', 'and'] as const) {
      const text = prefixed(line, words[kind]);
      if (text) { ensureScenario().steps.push({ kind, text }); matched = true; break; }
    }
    if (!matched) {
      const bullet = line.match(/^[-*•]\s+(.+)$/);
      if (bullet) ensureScenario().steps.push({ kind: 'then', text: bullet[1].trim() });
      else if (current?.steps.length) current.steps[current.steps.length - 1].text += ` ${line}`;
    }
  }
  if (!scenarios.length || scenarios.every((scenario) => !scenario.steps.length)) {
    throw new Error('No Given/When/Then or bullet acceptance criteria found');
  }
  return { name, scenarios };
}
