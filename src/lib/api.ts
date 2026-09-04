import { type Config, clearNeedsLogin, markNeedsLogin } from './config.js';

/**
 * Talking to Pixelhof from a terminal.
 *
 * A signed-out CLI is an everyday state and not a crash, so a dead token comes
 * back as `null` with the flag set rather than as a thrown error every caller
 * would have to catch. Anything else the site does wrong is thrown, because a
 * person at a prompt can read it and decide what to do.
 */

/** What the site says the viewer's work is worth. Mirrors `MyWork` in the server contract. */
export type MyWork = {
  name: string;
  xp: number;
  minutes: number;
  today: { minutes: number; xp: number; taler: number };
  rank: number | null;
  working: number;
};

export const apiUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, '')}${path}`;

export class ApiError extends Error {}

/** The viewer's work, or `null` when the stored token no longer signs anybody in. */
export async function fetchMyWork(config: Config): Promise<MyWork | null> {
  const response = await fetch(apiUrl(config.url, '/api/agent/me'), {
    headers: { authorization: `Bearer ${config.token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) {
    markNeedsLogin();
    return null;
  }
  if (!response.ok) {
    throw new ApiError(`${config.url} answered ${response.status} for /api/agent/me.`);
  }
  clearNeedsLogin();
  return (await response.json()) as MyWork;
}
