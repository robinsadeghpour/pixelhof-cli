import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BEAT_THROTTLE_MS,
  BEAT_TIMEOUT_MS,
  type Beat,
  type BeatEvent,
  MAX_SESSION_ID,
  agentFor,
} from './lib/agents.js';
import { clearNeedsLogin, markNeedsLogin, readConfig, resolveUrl, stateDir } from './lib/config.js';
import { eventFor, integrationFor } from './lib/integrations.js';

/**
 * The hook path, and the only one that runs while somebody is working.
 *
 * Everything here is judged on two things: it never speaks, and it is quick.
 * It never speaks because it runs inside another agent's session, where a line
 * on stdout is at best noise and at worst something that agent tries to read.
 * It is quick because it runs after every tool call, so the person pays for it
 * in latency. That is why nothing in this file's imports reaches an argument
 * parser, and why a throttled beat gets no further than one small file read.
 */

/** The one thing this path prints, and only when asked for it. */
const USAGE = 'usage: pixelhof beat --agent <claude-code|codex|gemini|cursor|opencode|other>';

const hash = (value: string): string => createHash('sha1').update(value).digest('hex');

/** Stale state files a machine no longer has sessions for, swept on the way past. */
const STATE_KEEP_MS = 24 * 60 * 60 * 1000;

function readStdin(): unknown {
  if (process.stdin.isTTY === true) return null;
  try {
    const text = readFileSync(0, 'utf8').trim();
    return text === '' ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The session this beat belongs to.
 *
 * Every agent names it something different, so the integration says which keys
 * to try. When the payload names none, the working directory and the parent
 * process stand in: two hooks fired by the same agent run share both, and a
 * second agent in a second directory gets a shift of its own.
 */
function sessionOf(payload: unknown, keys: readonly string[]): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    for (const key of [...keys, 'session_id', 'conversation_id']) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value.slice(0, MAX_SESSION_ID);
    }
  }
  return hash(`${process.cwd()}:${process.ppid}`);
}

const statePath = (beat: Beat): string =>
  join(stateDir(), `${hash(`${beat.agent}:${beat.sessionId}`)}.json`);

function lastSentAt(path: string): number {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const at = (parsed as { sentAt?: unknown }).sentAt;
    return typeof at === 'number' ? at : 0;
  } catch {
    return 0;
  }
}

/**
 * True when this beat is close enough behind the last that the server would
 * learn nothing from it. A `start` and a `stop` are never held back: they are
 * the two that move a worker on and off the map.
 */
export function isThrottled(event: BeatEvent, sentAt: number, now: number): boolean {
  return event === 'beat' && now - sentAt < BEAT_THROTTLE_MS;
}

function recordSent(path: string, now: number): void {
  try {
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ sentAt: now }), { mode: 0o600 });
  } catch {
    // A beat that cannot remember itself is sent again in 45 seconds. No worse.
  }
}

function sweepStaleState(now: number): void {
  try {
    for (const name of readdirSync(stateDir())) {
      const path = join(stateDir(), name);
      if (now - statSync(path).mtimeMs > STATE_KEEP_MS) unlinkSync(path);
    }
  } catch {
    // Housekeeping, never a reason to fail a beat.
  }
}

async function send(beat: Beat, url: string, token: string): Promise<void> {
  const response = await fetch(`${url.replace(/\/+$/, '')}/api/agent/beat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(beat),
    signal: AbortSignal.timeout(BEAT_TIMEOUT_MS),
  });
  if (response.status === 401) markNeedsLogin();
  else if (response.ok) clearNeedsLogin();
}

export async function runBeat(argv: readonly string[]): Promise<void> {
  const flag = argv.indexOf('--agent');
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(`${USAGE}\n`);
    return;
  }
  const agent = agentFor(flag === -1 ? null : argv[flag + 1]);
  const integration = integrationFor(agent);
  const payload = readStdin();
  const beat: Beat = {
    agent,
    sessionId: sessionOf(payload, integration?.sessionKeys ?? []),
    event: eventFor(integration, (payload as { hook_event_name?: unknown })?.hook_event_name),
  };

  const path = statePath(beat);
  const now = Date.now();
  if (isThrottled(beat.event, lastSentAt(path), now)) return;

  const config = readConfig();
  if (config === null) return;
  // One file per session would otherwise pile up forever. The two events that
  // bracket a shift are rare enough to afford a readdir; a plain beat is not.
  if (beat.event !== 'beat') sweepStaleState(now);

  recordSent(path, now);
  try {
    await send(beat, resolveUrl(undefined, config), config.token);
  } catch {
    // A site that is down, slow or unreachable is not the person's problem
    // while they are working. The next beat tries again.
  }
}
