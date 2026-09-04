import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where this CLI keeps the one secret it holds.
 *
 * The token is a session token: whoever reads it is signed in as the person, so
 * the directory is theirs alone (0700) and the file is theirs alone (0600). The
 * whole path hangs off the home directory rather than a module constant so a
 * test can point HOME at a temp directory and never touch a real config.
 */

export const PRODUCTION_URL = 'https://pixelhof.com';

/** The client this CLI identifies as in the device flow. */
export const CLIENT_ID = 'pixelhof-cli';

export type Config = { url: string; token: string };

export const configDir = (): string => join(homedir(), '.pixelhof');
export const configPath = (): string => join(configDir(), 'config.json');
export const stateDir = (): string => join(configDir(), 'state');
export const needsLoginPath = (): string => join(configDir(), 'needs-login');

export function readConfig(): Config | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { url, token } = parsed as Partial<Config>;
    if (typeof url !== 'string' || typeof token !== 'string' || token === '') return null;
    return { url, token };
  } catch {
    return null;
  }
}

export function writeConfig(config: Config): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function clearConfig(): void {
  rmSync(configPath(), { force: true });
  clearNeedsLogin();
}

/**
 * The site to talk to. An explicit `--url` wins, then the environment, then
 * whatever the last login stored, so a developer can point one command at a
 * local server without logging out of the real one.
 */
export function resolveUrl(explicit?: string | undefined, stored?: Config | null): string {
  const env = process.env['PIXELHOF_URL'];
  if (explicit !== undefined && explicit !== '') return explicit;
  if (env !== undefined && env !== '') return env;
  return (stored === undefined ? readConfig() : stored)?.url ?? PRODUCTION_URL;
}

/**
 * A flag, not a message. The hook runs with nowhere to print, so a beat that is
 * turned away leaves this behind and `status` and `doctor` are the ones that say
 * so out loud.
 */
export function markNeedsLogin(): void {
  try {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(needsLoginPath(), '', { mode: 0o600 });
  } catch {
    // A hook that cannot write its own state still exits quietly.
  }
}

export function clearNeedsLogin(): void {
  try {
    rmSync(needsLoginPath(), { force: true });
  } catch {
    // As above.
  }
}

export function needsLogin(): boolean {
  try {
    readFileSync(needsLoginPath());
    return true;
  } catch {
    return false;
  }
}
