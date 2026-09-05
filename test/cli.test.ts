import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runFile = promisify(execFile);
let fixtureDir = '';
let entry = '';

beforeEach(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'pixelhof-cli-'));
  entry = join(fixtureDir, 'pixelhof.js');
  writeFileSync(join(fixtureDir, 'package.json'), JSON.stringify({ type: 'module' }));
  const moduleUrl = pathToFileURL(join(root, 'src', 'cli.ts')).href;
  writeFileSync(entry, `import { main } from ${JSON.stringify(moduleUrl)};\nawait main(process.argv);\n`);
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

async function cli(...args: string[]): Promise<string> {
  const env = {
    ...process.env,
    HOME: fixtureDir,
    CLAUDE_CONFIG_DIR: join(fixtureDir, '.claude'),
    CODEX_HOME: join(fixtureDir, '.codex'),
  };
  const { stdout, stderr } = await runFile(process.execPath, ['--import', 'tsx', entry, ...args], {
    cwd: root,
    env,
  });
  expect(stderr).toBe('');
  return stdout;
}

function seedCodex(command: string): string {
  const path = join(fixtureDir, '.codex', 'hooks.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command }] }],
      PostToolUse: [{ hooks: [
        { type: 'command', command },
        { type: 'command', command: 'echo unrelated-hook' },
      ] }],
    },
  }));
  return path;
}

describe('doctor', () => {
  test('a direct CLI reports the saved npx command, without changing the config', async () => {
    const command = 'npx -y pixelhof beat --agent codex';
    const path = seedCodex(command);
    const before = readFileSync(path, 'utf8');

    const output = await cli('doctor');

    expect(output).toMatch(/Codex\s+configured\s/);
    expect(output.split(command)).toHaveLength(2);
    expect(output).toContain('Some saved hooks use npx');
    expect(output).not.toContain(entry);
    expect(output).not.toContain('unrelated-hook');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  test('reports the saved direct path and explains that configuration does not verify trust', async () => {
    const command = '"/opt/node" "/opt/pixelhof/dist/index.js" beat --agent codex';
    seedCodex(command);

    const output = await cli('doctor');

    expect(output).toContain(command);
    expect(output).not.toContain('Some saved hooks use npx');
    expect(output).toContain('does not confirm they are running');
    expect(output).toContain('run `/hooks`, and review/trust the exact Pixelhof hook definitions');
    expect(output).toContain('Trust cannot be verified from hooks.json');
  });

  test('absent hooks are not configured and do not need trust guidance', async () => {
    const output = await cli('doctor');
    expect(output).toMatch(/Codex\s+not configured\s/);
    expect(output).not.toContain('run `/hooks`');
  });
});

describe('install guidance', () => {
  test.each(['codex', 'all'])('%s requires a Codex trust review without writing trust state', async (agent) => {
    const output = await cli('install', '--agent', agent);

    expect(existsSync(join(fixtureDir, '.codex', 'hooks.json'))).toBe(true);
    expect(output).toContain('run `/hooks`, and review/trust the exact Pixelhof hook definitions');
    expect(output).toContain('Codex must trust them before they can send activity');
    expect(output).toContain('Changing a hook command requires another review');
    expect(output).toContain('Start a fresh Codex session after review');
    expect(existsSync(join(fixtureDir, '.codex', 'config.toml'))).toBe(false);
  });

  test('Claude-only installation gives no Codex instructions', async () => {
    const output = await cli('install', '--agent', 'claude-code');

    expect(existsSync(join(fixtureDir, '.claude', 'settings.json'))).toBe(true);
    expect(output).not.toContain('Codex');
    expect(output).not.toContain('/hooks');
  });
});
