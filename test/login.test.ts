import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { CLIENT_ID } from '../src/lib/config.js';
import { DeviceError, type DeviceIo, deviceLogin } from '../src/lib/device.js';

/**
 * The sign-in against a server that answers the way better-auth's
 * device-authorization plugin does: `/api/auth/device/code` hands out a pair of
 * codes, and `/api/auth/device/token` says `authorization_pending` until
 * somebody has confirmed the short one.
 */

type Reply = { status: number; body: unknown };

/** What better-auth answers a POST to its own routes that claims no origin it trusts. */
const FORBIDDEN: Reply = { status: 403, body: { message: 'Invalid origin' } };

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = undefined;
});

async function fakeSite(replies: readonly Reply[], codeReply?: Reply) {
  const seen: { path: string; body: unknown; origin: string | undefined }[] = [];
  let poll = 0;
  let base = '';
  const answer = (path: string, origin: string | undefined): Reply => {
    if (origin !== base) return FORBIDDEN;
    if (path !== '/api/auth/device/code') {
      return replies[Math.min(poll++, replies.length - 1)] as Reply;
    }
    return (
      codeReply ?? {
        status: 200,
        body: {
          device_code: 'the-long-one',
          user_code: 'WDJB-MJHT',
          verification_uri: '/device',
          verification_uri_complete: '/device?user_code=WDJB-MJHT',
          expires_in: 1800,
          interval: 5,
        },
      }
    );
  };
  server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const body: unknown = raw === '' ? null : JSON.parse(raw);
      const origin = request.headers.origin;
      seen.push({ path: request.url ?? '', body, origin });
      const reply = answer(request.url ?? '', origin);
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server?.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  return { url: base, seen };
}

function recordingIo(): DeviceIo & { lines: string[]; opened: string[]; waits: number[] } {
  const lines: string[] = [];
  const opened: string[] = [];
  const waits: number[] = [];
  return {
    lines,
    opened,
    waits,
    print: (line) => lines.push(line),
    open: (target) => opened.push(target),
    sleep: async (ms) => {
      waits.push(ms);
    },
    now: () => Date.now(),
  };
}

const pending: Reply = {
  status: 400,
  body: { error: 'authorization_pending', error_description: 'Authorization pending' },
};

describe('the device flow', () => {
  test('waits through two pending answers and comes back with a token', async () => {
    const approved: Reply = {
      status: 200,
      body: { access_token: 'a-session-token', token_type: 'Bearer', expires_in: 604800, scope: '' },
    };
    const { url, seen } = await fakeSite([pending, pending, approved]);
    const io = recordingIo();

    await expect(deviceLogin(url, io)).resolves.toBe('a-session-token');

    expect(seen.map((r) => r.path)).toEqual([
      '/api/auth/device/code',
      '/api/auth/device/token',
      '/api/auth/device/token',
      '/api/auth/device/token',
    ]);
    expect(seen[0]?.body).toEqual({ client_id: CLIENT_ID });
    expect(seen.map((r) => r.origin)).toEqual([url, url, url, url]);
    expect(seen[1]?.body).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'the-long-one',
      client_id: CLIENT_ID,
    });
  });

  test('shows the short code and opens the page, and never shows the long one', async () => {
    const { url } = await fakeSite([
      { status: 200, body: { access_token: 'a-session-token' } },
    ]);
    const io = recordingIo();
    await deviceLogin(url, io);

    expect(io.lines.join('\n')).toContain('WDJB-MJHT');
    expect(io.lines.join('\n')).not.toContain('the-long-one');
    expect(io.opened).toEqual([`${url}/device?user_code=WDJB-MJHT`]);
  });

  test('obeys the interval the site sets, and backs off when told to slow down', async () => {
    const { url } = await fakeSite([
      { status: 400, body: { error: 'slow_down', error_description: 'Polling too frequently' } },
      { status: 200, body: { access_token: 'a-session-token' } },
    ]);
    const io = recordingIo();
    await deviceLogin(url, io);
    expect(io.waits).toEqual([5000, 10000]);
  });

  test('a refusal in the browser is said plainly and not retried', async () => {
    const { url, seen } = await fakeSite([
      { status: 400, body: { error: 'access_denied', error_description: 'Access denied' } },
    ]);
    await expect(deviceLogin(url, recordingIo())).rejects.toThrow(DeviceError);
    await expect(deviceLogin(url, recordingIo())).rejects.toThrow(/turned down in the browser/);
    expect(seen.filter((r) => r.path.endsWith('/token'))).toHaveLength(2);
  });

  test('a code that ran out says which command starts again', async () => {
    const { url } = await fakeSite([
      { status: 400, body: { error: 'expired_token', error_description: 'Device code has expired' } },
    ]);
    await expect(deviceLogin(url, recordingIo())).rejects.toThrow(/pixelhof login/);
  });

  test('every request to the auth routes says which site it is signing in to', async () => {
    const { url, seen } = await fakeSite([{ status: 200, body: { access_token: 'a-session-token' } }]);
    await deviceLogin(url, recordingIo());
    // A better-auth route turns away a POST whose Origin it does not trust, so
    // a run that reached a token at all proves the header went out on both.
    expect(seen.every((r) => r.origin === url)).toBe(true);
    expect(new URL(url).origin).toBe(url);
  });

  test('a site that will not start a sign-in says so before any polling', async () => {
    const { url, seen } = await fakeSite([], {
      status: 400,
      body: { error: 'invalid_client', error_description: 'Unknown client' },
    });
    await expect(deviceLogin(url, recordingIo())).rejects.toThrow(/Unknown client/);
    expect(seen).toHaveLength(1);
  });

  test('a code that expires while nobody confirms it gives up rather than polling forever', async () => {
    const { url } = await fakeSite([pending], {
      status: 200,
      body: { device_code: 'd', user_code: 'U', verification_uri: '/device', expires_in: 0, interval: 1 },
    });
    await expect(deviceLogin(url, recordingIo())).rejects.toThrow(/ran out/);
  });
});
