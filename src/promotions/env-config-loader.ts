import { readFile } from 'node:fs/promises';

/** Configuration for one promotion environment. */
export interface PromotionEnvironment {
  url: string;
  /** Environment variables mapped to source process variable names, never raw secrets. */
  variables?: Record<string, string>;
  testData?: string;
  /** Optional minimum statement coverage required before promotion. */
  minimumCoverage?: number;
}

/** Multi-environment promotion configuration. */
export interface PromotionConfig {
  environments: Record<string, PromotionEnvironment>;
  chains: Record<string, string[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch { return false; }
}

/** Validates parsed promotion configuration and returns a typed value. */
export function parsePromotionConfig(value: unknown): PromotionConfig {
  if (!isRecord(value) || !isRecord(value['environments']) || !isRecord(value['chains'])) {
    throw new Error('Promotion config must contain environments and chains objects');
  }
  const environments: Record<string, PromotionEnvironment> = {};
  for (const [name, raw] of Object.entries(value['environments'])) {
    if (!isRecord(raw) || !validUrl(raw['url'])) throw new Error(`Environment "${name}" must have a valid HTTP(S) URL`);
    let variables: Record<string, string> | undefined;
    if (raw['variables'] !== undefined) {
      if (!isRecord(raw['variables'])) throw new Error(`Environment "${name}" variables must be an object`);
      variables = {};
      for (const [target, source] of Object.entries(raw['variables'])) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(target) || typeof source !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source)) {
          throw new Error(`Environment "${name}" has an invalid variable mapping`);
        }
        variables[target] = source;
      }
    }
    if (raw['testData'] !== undefined && typeof raw['testData'] !== 'string') throw new Error(`Environment "${name}" testData must be a path`);
    const minimumCoverage = raw['minimumCoverage'];
    if (minimumCoverage !== undefined && (typeof minimumCoverage !== 'number' || minimumCoverage < 0 || minimumCoverage > 100)) {
      throw new Error(`Environment "${name}" minimumCoverage must be between 0 and 100`);
    }
    environments[name] = {
      url: raw['url'],
      variables,
      testData: raw['testData'] as string | undefined,
      minimumCoverage
    };
  }
  const chains: Record<string, string[]> = {};
  for (const [name, raw] of Object.entries(value['chains'])) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((item) => typeof item !== 'string')) {
      throw new Error(`Promotion chain "${name}" must be a non-empty environment list`);
    }
    const chain = raw as string[];
    if (new Set(chain).size !== chain.length) throw new Error(`Promotion chain "${name}" contains duplicate environments`);
    for (const environment of chain) if (!environments[environment]) throw new Error(`Promotion chain "${name}" references unknown environment "${environment}"`);
    chains[name] = [...chain];
  }
  return { environments, chains };
}

/** Loads and validates a JSON promotion configuration file. */
export async function loadPromotionConfig(filePath: string): Promise<PromotionConfig> {
  try {
    return parsePromotionConfig(JSON.parse(await readFile(filePath, 'utf-8')) as unknown);
  } catch (error) {
    throw new Error(`Unable to load promotion config "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
  }
}
