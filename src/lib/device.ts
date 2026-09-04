import { spawn } from 'node:child_process';
import { CLIENT_ID } from './config.js';

/**
 * Signing in without pasting a key.
 *
 * This is RFC 8628 against the endpoints better-auth's device-authorization
 * plugin mounts under `/api/auth/device/`. The CLI asks for a pair of codes,
 * shows the person the short one, and then asks the site over and over whether
 * anybody has typed it yet. Nothing secret is ever shown on the terminal or
 * passed on a command line: the long code stays inside this process and the
 * token it earns goes straight to a file only its owner can read.
 *
 * The site sets the polling interval and this obeys it, including the `slow_down`
 * the spec uses to push a chatty client back. Hammering a login endpoint is how
 * a client gets rate limited into looking broken.
 */

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type DeviceIo = {
  print(line: string): void;
  open(url: string): void;
  sleep(ms: number): Promise<void>;
  now(): number;
};

/** How much a `slow_down` adds to the wait, per RFC 8628 section 3.5. */
const SLOW_DOWN_STEP_MS = 5_000;

const REQUEST_TIMEOUT_MS = 10_000;

export class DeviceError extends Error {}

const endpoint = (url: string, path: string): string => `${url.replace(/\/+$/, '')}${path}`;

/** Absolute, because the site may hand back a path and a person cannot click a path. */
const absolute = (uri: string, base: string): string =>
  /^https?:\/\//.test(uri) ? uri : endpoint(base, uri.startsWith('/') ? uri : `/${uri}`);

/**
 * The site the request claims to come from.
 *
 * better-auth turns away a POST to its own routes whose `Origin` it does not
 * trust, and a CLI sends none of its own accord because it is not a browser.
 * So it says the site it is signing in to, which is the one the token will be
 * used against. An Origin is a scheme and a host, never a path, so it is
 * derived rather than copied.
 */
const originOf = (base: string): string => new URL(base).origin;

async function postJson(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(endpoint(base, path), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: originOf(base),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

/** The RFC's error code out of whatever shape the site wrapped it in. */
function errorCode(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const { error, code } = body as { error?: unknown; code?: unknown };
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const inner = (error as { code?: unknown }).code;
    if (typeof inner === 'string') return inner;
  }
  return typeof code === 'string' ? code : '';
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;
  const { error_description: description } = body as { error_description?: unknown };
  return typeof description === 'string' && description !== '' ? description : fallback;
}

export async function requestDeviceCode(url: string): Promise<DeviceCode> {
  const { status, body } = await postJson(url, '/api/auth/device/code', { client_id: CLIENT_ID });
  if (status !== 200) {
    throw new DeviceError(errorMessage(body, `${url} would not start a sign-in (${status}).`));
  }
  const code = body as Partial<DeviceCode>;
  if (typeof code.device_code !== 'string' || typeof code.user_code !== 'string') {
    throw new DeviceError(`${url} answered without a device code.`);
  }
  return {
    device_code: code.device_code,
    user_code: code.user_code,
    verification_uri: code.verification_uri ?? '/device',
    ...(code.verification_uri_complete === undefined
      ? {}
      : { verification_uri_complete: code.verification_uri_complete }),
    expires_in: typeof code.expires_in === 'number' ? code.expires_in : 600,
    interval: typeof code.interval === 'number' ? code.interval : 5,
  };
}

/**
 * Ask until somebody answers. Returns the session token to store, and throws
 * with something a person can act on when the code is refused or runs out.
 */
export async function pollForToken(
  url: string,
  code: DeviceCode,
  io: DeviceIo,
): Promise<string> {
  const deadline = io.now() + code.expires_in * 1000;
  let wait = Math.max(code.interval, 1) * 1000;
  while (io.now() < deadline) {
    await io.sleep(wait);
    const { status, body } = await postJson(url, '/api/auth/device/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: code.device_code,
      client_id: CLIENT_ID,
    });
    if (status === 200) {
      const token = (body as { access_token?: unknown }).access_token;
      if (typeof token !== 'string' || token === '') {
        throw new DeviceError(`${url} approved the sign-in but sent no token.`);
      }
      return token;
    }
    switch (errorCode(body)) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        wait += SLOW_DOWN_STEP_MS;
        continue;
      case 'access_denied':
        throw new DeviceError('The sign-in was turned down in the browser.');
      case 'expired_token':
        throw new DeviceError('The code ran out. Run `pixelhof login` again.');
      default:
        if (status === 429) {
          wait += SLOW_DOWN_STEP_MS;
          continue;
        }
        throw new DeviceError(errorMessage(body, `${url} refused the sign-in (${status}).`));
    }
  }
  throw new DeviceError('The code ran out. Run `pixelhof login` again.');
}

/** The whole flow, from asking for a code to holding a token. */
export async function deviceLogin(url: string, io: DeviceIo): Promise<string> {
  const code = await requestDeviceCode(url);
  // The complete URL carries the code in it, so the page can fill it in and the
  // person only has to check that what they see matches what is on the terminal.
  const page = absolute(code.verification_uri_complete ?? code.verification_uri, url);
  io.print(`Your code is ${code.user_code}`);
  io.print(`Confirm it at ${page}`);
  io.open(page);
  io.print('Waiting for you to confirm it...');
  return pollForToken(url, code, io);
}

/** Open a page, and say nothing when the machine has no way to. */
export function openBrowser(target: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(command, [target], {
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // A headless machine reads the URL off the screen instead.
  }
}
