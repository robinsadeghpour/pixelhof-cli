import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { BEAT_THROTTLE_MS } from '../src/lib/agents.js';
import { isThrottled } from '../src/beat.js';

/**
 * The hook path, run the way a coding agent runs it: as its own process, with
 * a payload on stdin and nobody reading stdout.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

type Sent = { agent: string; sessionId: string; event: string; auth: string | undefined };

let home = '';
let server: Server | undefined;
let sent: Sent[] = [];
let status = 200;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'pixelhof-beat-'));
  sent = [];
  status = 200;
  server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const body = JSON.parse(raw === '' ? '{}' : raw) as Omit<Sent, 'auth'>;
      sent.push({ ...body, auth: request.headers.authorization });
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(
        status === 200
          ? JSON.stringify({
              shift: { minutes: 3, live: true },
              today: { minutes: 3, xp: 3, taler: 0 },
              worker: { onMap: true },
            })
          : JSON.stringify({ error: 'signed-out' }),
      );
    });
  });
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  const { port } = server?.address() as AddressInfo;
  mkdirSync(join(home, '.pixelhof'), { recursive: true });
  writeFileSync(
    join(home, '.pixelhof', 'config.json'),
    JSON.stringify({ url: `http://127.0.0.1:${port}`, token: 'a-session-token' }),
  );
});

afterEach(async () => {
  await new Promise<void>((done) => server?.close(() => done()) ?? done());
  server = undefined;
  rmSync(home, { recursive: true, force: true });
});

type Run = { code: number | null; stdout: string; stderr: string };

function beat(payload: string, agent = 'claude-code', env: Record<string, string> = {}): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [tsx, join(root, 'src', 'index.ts'), 'beat', '--agent', agent], {
      cwd: root,
      env: { ...process.env, HOME: home, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => done({ code, stdout, stderr }));
    child.stdin.end(payload);
  });
}

const payload = (event: string, session = 's-1'): string =>
  JSON.stringify({ session_id: session, hook_event_name: event, cwd: '/somewhere/private' });

describe('a beat as an agent runs it', () => {
  test('sends the start, holds the next beat back, and always sends the stop', async () => {
    expect((await beat(payload('SessionStart'))).code).toBe(0);
    expect((await beat(payload('PostToolUse'))).code).toBe(0);
    expect((await beat(payload('Stop'))).code).toBe(0);
    expect((await beat(payload('SessionEnd'))).code).toBe(0);

    expect(sent.map((s) => s.event)).toEqual(['start', 'stop']);
    expect(sent[0]).toMatchObject({
      agent: 'claude-code',
      sessionId: 's-1',
      auth: 'Bearer a-session-token',
    });
  });

  test('a different session is throttled on its own', async () => {
    await beat(payload('PostToolUse', 's-1'));
    await beat(payload('PostToolUse', 's-1'));
    await beat(payload('PostToolUse', 's-2'));
    expect(sent.map((s) => s.sessionId)).toEqual(['s-1', 's-2']);
  });

  test('says nothing on stdout, whatever happens', async () => {
    const started = await beat(payload('SessionStart'));
    const throttled = await beat(payload('PostToolUse'));
    expect(started.stdout).toBe('');
    expect(throttled.stdout).toBe('');
  });

  test('sends nothing but the session, the agent and the event', async () => {
    await beat(payload('SessionStart'));
    expect(Object.keys(sent[0] ?? {}).sort()).toEqual(['agent', 'auth', 'event', 'sessionId']);
    expect(JSON.stringify(sent)).not.toContain('/somewhere/private');
  });

  test('an unknown agent is sent as `other` rather than refused', async () => {
    await beat(payload('SessionStart'), 'some-new-thing');
    expect(sent[0]?.agent).toBe('other');
  });

  test('Cursor names its session differently, and is read on its own terms', async () => {
    await beat(JSON.stringify({ conversation_id: 'c-9', hook_event_name: 'sessionStart' }), 'cursor');
    expect(sent[0]).toMatchObject({ agent: 'cursor', sessionId: 'c-9', event: 'start' });
  });

  test('an empty payload still beats, under a session of its own', async () => {
    const run = await beat('');
    expect(run.code).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.event).toBe('beat');
    expect(sent[0]?.sessionId).toMatch(/^[0-9a-f]{40}$/);
  });

  test('a turned-away beat leaves a flag behind, and a good one clears it', async () => {
    status = 401;
    await beat(payload('SessionStart', 'a'));
    expect(existsSync(join(home, '.pixelhof', 'needs-login'))).toBe(true);

    status = 200;
    await beat(payload('SessionStart', 'b'));
    expect(existsSync(join(home, '.pixelhof', 'needs-login'))).toBe(false);
  });

  test('a site that cannot be reached costs the person nothing', async () => {
    const run = await beat(payload('SessionStart'), 'claude-code', {
      PIXELHOF_URL: 'http://127.0.0.1:1',
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
  });

  test('with nobody signed in it sends nothing and still exits cleanly', async () => {
    rmSync(join(home, '.pixelhof', 'config.json'));
    const run = await beat(payload('SessionStart'));
    expect(run.code).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe('the throttle', () => {
  test('holds a beat back for 45 seconds and no longer', () => {
    const now = 1_000_000;
    expect(isThrottled('beat', now, now)).toBe(true);
    expect(isThrottled('beat', now - BEAT_THROTTLE_MS + 1, now)).toBe(true);
    expect(isThrottled('beat', now - BEAT_THROTTLE_MS, now)).toBe(false);
  });

  test('never holds back the two events that move a worker on and off the map', () => {
    const now = 1_000_000;
    expect(isThrottled('start', now, now)).toBe(false);
    expect(isThrottled('stop', now, now)).toBe(false);
  });

  test('a session never beaten before is not held back', () => {
    expect(isThrottled('beat', 0, Date.now())).toBe(false);
  });
});

describe('what the hook path is allowed to load', () => {
  const importsOf = (file: string): string[] =>
    [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1] as string);

  const reachableFrom = (entry: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(entry)) return seen;
    seen.add(entry);
    for (const specifier of importsOf(entry)) {
      if (!specifier.startsWith('.')) {
        seen.add(specifier);
        continue;
      }
      reachableFrom(resolve(dirname(entry), specifier.replace(/\.js$/, '.ts')), seen);
    }
    return seen;
  };

  test('nothing the beat imports reaches an argument parser', () => {
    const reachable = reachableFrom(join(root, 'src', 'beat.ts'));
    expect([...reachable].filter((m) => !m.startsWith('/')).sort()).toEqual([
      'node:crypto',
      'node:fs',
      'node:os',
      'node:path',
    ]);
  });

  test('the entry point names no module until it knows which half is running', () => {
    expect(importsOf(join(root, 'src', 'index.ts'))).toEqual([]);
  });
});
