import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FigmaCredentialStore } from '../../src/storage/figma-credentials';
import { generateFigmaTests } from '../../src/generators/figma-test-generator';

describe('FigmaCredentialStore', () => {
  it('stores OAuth credentials encrypted in SQLite and reopens them', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-figma-store-'));
    const file = path.join(directory, 'credentials.sqlite');
    const secret = 'a-secure-test-key-at-least-16';
    const first = await FigmaCredentialStore.open(file, secret);
    await first.save({ accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: '2026-08-01' });
    first.close();
    const bytes = await readFile(file);
    expect(bytes.includes(Buffer.from('access-secret'))).toBe(false);
    const second = await FigmaCredentialStore.open(file, secret);
    expect(second.load()).toEqual({ accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: '2026-08-01' });
    expect(second.load('missing')).toBeUndefined();
    second.close();
  });

  it('rejects weak keys, empty tokens, and incorrect decryption keys', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-figma-store-'));
    const file = path.join(directory, 'credentials.sqlite');
    await expect(FigmaCredentialStore.open(file, 'short')).rejects.toThrow('at least 16');
    const first = await FigmaCredentialStore.open(file, 'correct-secret-key-value');
    await expect(first.save({ accessToken: ' ' })).rejects.toThrow('access token');
    await first.save({ accessToken: 'secret' });
    first.close();
    const wrong = await FigmaCredentialStore.open(file, 'different-secret-key');
    expect(() => wrong.load()).toThrow();
    wrong.close();
  });

  it('validates expiry, lists profiles without secrets, and deletes profiles', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-figma-store-'));
    const file = path.join(directory, 'credentials.sqlite');
    const store = await FigmaCredentialStore.open(file, 'correct-secret-key-value');
    await store.save({ accessToken: 'alpha-secret', expiresAt: '2030-01-01T00:00:00.000Z' }, 'alpha');
    await store.save({ accessToken: 'expired-secret', expiresAt: '2020-01-01T00:00:00.000Z' }, 'expired');
    expect(store.listProfiles()).toEqual(['alpha', 'expired']);
    expect(store.loadValid('alpha', Date.parse('2029-01-01T00:00:00.000Z'))?.accessToken).toBe('alpha-secret');
    expect(() => store.loadValid('expired', Date.parse('2029-01-01T00:00:00.000Z')))
      .toThrow('expired or near expiry');
    await expect(store.save({ accessToken: 'x', expiresAt: 'not-a-date' }, 'bad')).rejects.toThrow('ISO-8601');
    await expect(store.save({ accessToken: 'x' }, '../bad')).rejects.toThrow('profile');
    await expect(store.delete('missing')).resolves.toBe(false);
    await expect(store.delete('expired')).resolves.toBe(true);
    expect(store.listProfiles()).toEqual(['alpha']);
    store.close();
    const bytes = await readFile(file);
    expect(bytes.includes(Buffer.from('alpha-secret'))).toBe(false);
    expect(bytes.includes(Buffer.from('expired-secret'))).toBe(false);
  });
});

describe('generateFigmaTests', () => {
  it('generates click, fill, and assertion stubs', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-figma-tests-'));
    const files = await generateFigmaTests([
      { name: 'Primary Button', type: 'INSTANCE' },
      { name: 'Email Field', type: 'INSTANCE' },
      { name: 'Welcome Text', type: 'TEXT', text: 'Welcome' }
    ], directory);
    expect(files).toHaveLength(3);
    expect(await readFile(files[0], 'utf-8')).toContain('component.click()');
    expect(await readFile(files[1], 'utf-8')).toContain('component.fill(');
    expect(await readFile(files[2], 'utf-8')).toContain('toBeVisible()');
  });

  it('rejects empty input and refuses overwrites', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-figma-tests-'));
    await expect(generateFigmaTests([], directory)).rejects.toThrow('At least one');
    await generateFigmaTests([{ name: 'Button', type: 'INSTANCE' }], directory);
    await expect(generateFigmaTests([{ name: 'Button', type: 'INSTANCE' }], directory)).rejects.toThrow();
  });
});
