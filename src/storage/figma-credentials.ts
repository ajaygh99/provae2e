/** AES-GCM encrypted Figma OAuth credentials persisted in portable SQLite. */
import initSqlJs, { type Database } from 'sql.js';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface FigmaCredentials { accessToken: string; refreshToken?: string; expiresAt?: string; }
const PROFILE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function validateProfile(profile: string): void {
  if (!PROFILE_NAME.test(profile)) {
    throw new Error('Figma credential profile must contain 1-64 letters, numbers, underscores, or hyphens');
  }
}

function keyFromSecret(secret: string): Buffer {
  if (secret.length < 16) throw new Error('PROVA_CREDENTIAL_KEY must contain at least 16 characters');
  return createHash('sha256').update(secret).digest();
}

function encrypt(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function decrypt(value: string, secret: string): string {
  const [iv, tag, encrypted] = value.split('.');
  if (!iv || !tag || !encrypted) throw new Error('Stored Figma credentials are malformed');
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf-8');
}

/** Encrypted single-profile Figma credential repository. */
export class FigmaCredentialStore {
  private constructor(private readonly filePath: string, private readonly database: Database, private readonly secret: string) {}

  /** Opens or creates the encrypted credential database. */
  static async open(filePath: string, secret: string): Promise<FigmaCredentialStore> {
    keyFromSecret(secret);
    const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run('CREATE TABLE IF NOT EXISTS figma_credentials (profile TEXT PRIMARY KEY, encrypted TEXT NOT NULL)');
    const store = new FigmaCredentialStore(path.resolve(filePath), database, secret);
    await store.persist();
    return store;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }

  /** Encrypts and stores credentials, replacing the existing profile. */
  async save(credentials: FigmaCredentials, profile = 'default'): Promise<void> {
    validateProfile(profile);
    if (!credentials.accessToken.trim()) throw new Error('Figma access token is required');
    if (credentials.expiresAt && Number.isNaN(Date.parse(credentials.expiresAt))) {
      throw new Error('Figma credential expiresAt must be an ISO-8601 date');
    }
    this.database.run('INSERT OR REPLACE INTO figma_credentials (profile, encrypted) VALUES (?, ?)', [
      profile, encrypt(JSON.stringify(credentials), this.secret)
    ]);
    await this.persist();
  }

  /** Loads and decrypts credentials for one profile. */
  load(profile = 'default'): FigmaCredentials | undefined {
    validateProfile(profile);
    const statement = this.database.prepare('SELECT encrypted FROM figma_credentials WHERE profile=?');
    statement.bind([profile]);
    const row = statement.step() ? statement.getAsObject() : undefined;
    statement.free();
    if (!row) return undefined;
    const parsed = JSON.parse(decrypt(String(row['encrypted']), this.secret)) as FigmaCredentials;
    if (!parsed.accessToken) throw new Error('Stored Figma credentials do not contain an access token');
    return parsed;
  }

  /** Loads a non-expired credential, failing closed before a network request. */
  loadValid(profile = 'default', now = Date.now(), expirySkewMs = 60_000): FigmaCredentials | undefined {
    if (!Number.isFinite(now) || !Number.isFinite(expirySkewMs) || expirySkewMs < 0) {
      throw new Error('Figma credential expiry inputs are invalid');
    }
    const credentials = this.load(profile);
    if (!credentials?.expiresAt) return credentials;
    if (Date.parse(credentials.expiresAt) <= now + expirySkewMs) {
      throw new Error(`Figma credential profile "${profile}" is expired or near expiry; authenticate again`);
    }
    return credentials;
  }

  /** Lists profile names only; encrypted token material is never returned. */
  listProfiles(): string[] {
    const statement = this.database.prepare('SELECT profile FROM figma_credentials ORDER BY profile');
    const profiles: string[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      if (typeof row['profile'] === 'string') profiles.push(row['profile']);
    }
    statement.free();
    return profiles;
  }

  /** Removes one encrypted profile and persists the change. */
  async delete(profile = 'default'): Promise<boolean> {
    validateProfile(profile);
    const existed = this.load(profile) !== undefined;
    if (!existed) return false;
    this.database.run('DELETE FROM figma_credentials WHERE profile=?', [profile]);
    await this.persist();
    return true;
  }

  /** Releases the SQLite database. */
  close(): void { this.database.close(); }
}
