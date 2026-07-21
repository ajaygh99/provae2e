import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPromotionConfig, parsePromotionConfig } from '../../src/promotions/env-config-loader';

const valid = {
  environments: {
    dev: { url: 'https://dev.example.com' },
    qe: { url: 'http://qe.example.com', variables: { API_TOKEN: 'QE_API_TOKEN' }, testData: './qe.json' }
  },
  chains: { release: ['dev', 'qe'] }
};

describe('parsePromotionConfig', () => {
  it('accepts environments, ordered chains, variables, and test data', () => {
    expect(parsePromotionConfig(valid)).toEqual(valid);
  });

  it.each([
    ['null root', null, 'must contain environments and chains objects'],
    ['array root', [], 'must contain environments and chains objects'],
    ['missing environments', { chains: {} }, 'must contain environments and chains objects'],
    ['missing chains', { environments: {} }, 'must contain environments and chains objects'],
    ['environment array', { environments: [], chains: {} }, 'must contain environments and chains objects'],
    ['chain array at root', { environments: {}, chains: [] }, 'must contain environments and chains objects'],
    ['invalid environment', { environments: { dev: null }, chains: {} }, 'valid HTTP(S) URL'],
    ['relative URL', { environments: { dev: { url: '/dev' } }, chains: {} }, 'valid HTTP(S) URL'],
    ['FTP URL', { environments: { dev: { url: 'ftp://example.com' } }, chains: {} }, 'valid HTTP(S) URL'],
    ['URL credentials', { environments: { dev: { url: 'https://user:pass@example.com' } }, chains: {} }, 'valid HTTP(S) URL'],
    ['variables array', { environments: { dev: { url: 'https://dev.example.com', variables: [] } }, chains: {} }, 'variables must be an object'],
    ['bad target variable', { environments: { dev: { url: 'https://dev.example.com', variables: { 'BAD-NAME': 'SOURCE' } } }, chains: {} }, 'invalid variable mapping'],
    ['bad source variable', { environments: { dev: { url: 'https://dev.example.com', variables: { TARGET: 'BAD-NAME' } } }, chains: {} }, 'invalid variable mapping'],
    ['non-string source', { environments: { dev: { url: 'https://dev.example.com', variables: { TARGET: 3 } } }, chains: {} }, 'invalid variable mapping'],
    ['non-string test data', { environments: { dev: { url: 'https://dev.example.com', testData: 3 } }, chains: {} }, 'testData must be a path'],
    ['negative coverage', { environments: { dev: { url: 'https://dev.example.com', minimumCoverage: -1 } }, chains: {} }, 'minimumCoverage must be between 0 and 100'],
    ['excess coverage', { environments: { dev: { url: 'https://dev.example.com', minimumCoverage: 101 } }, chains: {} }, 'minimumCoverage must be between 0 and 100'],
    ['string coverage', { environments: { dev: { url: 'https://dev.example.com', minimumCoverage: '80' } }, chains: {} }, 'minimumCoverage must be between 0 and 100'],
    ['empty chain', { environments: valid.environments, chains: { release: [] } }, 'must be a non-empty environment list'],
    ['non-string chain item', { environments: valid.environments, chains: { release: ['dev', 3] } }, 'must be a non-empty environment list'],
    ['duplicate environment', { environments: valid.environments, chains: { release: ['dev', 'dev'] } }, 'contains duplicate environments'],
    ['unknown environment', { environments: valid.environments, chains: { release: ['dev', 'staging'] } }, 'references unknown environment "staging"']
  ])('rejects %s', (_name, input, message) => {
    expect(() => parsePromotionConfig(input)).toThrow(message as string);
  });
});

describe('loadPromotionConfig', () => {
  it('loads valid JSON from disk', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-promotion-'));
    const file = path.join(directory, 'config.json');
    await writeFile(file, JSON.stringify(valid), 'utf-8');
    await expect(loadPromotionConfig(file)).resolves.toEqual(valid);
  });

  it('adds file context to invalid JSON and missing-file errors', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-promotion-'));
    const invalid = path.join(directory, 'invalid.json');
    await writeFile(invalid, '{', 'utf-8');
    await expect(loadPromotionConfig(invalid)).rejects.toThrow(`Unable to load promotion config "${invalid}"`);
    await expect(loadPromotionConfig(path.join(directory, 'missing.json'))).rejects.toThrow('Unable to load promotion config');
  });
});
