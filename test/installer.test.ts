import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { beatCommand, configFileFor, install, isInstalled, launchOf, uninstall } from '../src/lib/install.js';
import { hasBeats } from '../src/lib/hooks.js';
import { INTEGRATIONS, integrationFor } from '../src/lib/integrations.js';

/**
 * The installer against a home directory of its own.
 *
 * Every path in the CLI hangs off `homedir()`, which reads HOME on each call,
 * so pointing HOME at a temp directory redirects the whole install and no test
 * can reach a real settings file.
 */

let home = '';
let realHome: string | undefined;

/**
 * The relocation variables the agents themselves honour. Cleared for every
 * test, because a developer running this suite inside a relocated Claude
 * Code would otherwise have the tests install into their real settings file.
 */
const RELOCATIONS = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME'] as const;
const realRelocations: Partial<Record<(typeof RELOCATIONS)[number], string>> = {};

beforeEach(() => {
  realHome = process.env['HOME'];
  home = mkdtempSync(join(tmpdir(), 'pixelhof-test-'));
  process.env['HOME'] = home;
  for (const name of RELOCATIONS) {
    realRelocations[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  if (realHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = realHome;
  for (const name of RELOCATIONS) {
    const was = realRelocations[name];
    if (was === undefined) delete process.env[name];
    else process.env[name] = was;
  }
  rmSync(home, { recursive: true, force: true });
});

const claude = integrationFor('claude-code')!;

/** Vitest's own argv would otherwise decide which command these tests write. */
const NPX = { kind: 'npx' } as const;

const bytesOf = (path: string): string => readFileSync(path, 'utf8');

function seed(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

describe('install', () => {
  test('writes into every agent, then reports the second run as a no-op', () => {
    for (const integration of INTEGRATIONS) {
      expect(install(integration, false, NPX).action, integration.id).toBe('written');
    }
    for (const integration of INTEGRATIONS) {
      expect(install(integration, false, NPX).action, integration.id).toBe('unchanged');
      expect(isInstalled(integration), integration.id).toBe(true);
    }
  });

  test('installing twice leaves the same bytes as installing once', () => {
    for (const integration of INTEGRATIONS) {
      install(integration, false, NPX);
      const once = bytesOf(configFileFor(integration));
      install(integration, false, NPX);
      expect(bytesOf(configFileFor(integration)), integration.id).toBe(once);
    }
  });

  test('a dry run changes nothing on disk', () => {
    for (const integration of INTEGRATIONS) {
      expect(install(integration, true, NPX).action).toBe('written');
      expect(isInstalled(integration), integration.id).toBe(false);
    }
  });

  test('a real install is written as a path node can run, with both parts quoted', () => {
    const command = beatCommand('cursor', { kind: 'installed', script: '/opt/pixelhof/dist/index.js' });
    expect(command).toBe(`"${process.execPath}" "/opt/pixelhof/dist/index.js" beat --agent cursor`);
    expect(command).not.toContain('npx');
  });

  test('only a copy living in npx\'s own cache is written as an npx call', () => {
    expect(beatCommand('cursor', { kind: 'npx' })).toBe('npx -y pixelhof beat --agent cursor');
  });

  test('either form is recognisable as ours, which is what uninstall needs', () => {
    for (const launch of [
      { kind: 'installed', script: '/opt/pixelhof/dist/index.js' },
      { kind: 'npx' },
    ] as const) {
      expect(hasBeats(beatCommand('cursor', launch)), launch.kind).toBe(true);
    }
  });

  test('a command that could never be found again is not written at all', () => {
    // Nothing in this path says `pixelhof`, so the entry would survive an
    // uninstall. The npx form is slower and removable, which wins.
    expect(beatCommand('cursor', { kind: 'installed', script: '/opt/anon/dist/index.js' })).toBe(
      'npx -y pixelhof beat --agent cursor',
    );
  });
});

describe('working out how this CLI was started', () => {
  test('a file node cannot run is not written into a hook', () => {
    expect(launchOf(join(process.cwd(), 'src', 'index.ts'))).toEqual({ kind: 'npx' });
  });

  test('a path that does not exist is not written into a hook', () => {
    expect(launchOf('/no/such/pixelhof')).toEqual({ kind: 'npx' });
  });

  test('a copy in npx\'s cache is temporary, so it is named by package and not by path', () => {
    const cached = join(home, '.npm', '_npx', 'abc123', 'node_modules', 'pixelhof', 'dist', 'index.js');
    mkdirSync(dirname(cached), { recursive: true });
    writeFileSync(cached, '', 'utf8');
    expect(launchOf(cached)).toEqual({ kind: 'npx' });
  });

  test('a real install is followed through its symlink to the file itself', () => {
    const real = join(home, 'lib', 'node_modules', 'pixelhof', 'dist', 'index.js');
    mkdirSync(dirname(real), { recursive: true });
    writeFileSync(real, '', 'utf8');
    const bin = join(home, 'bin', 'pixelhof');
    mkdirSync(dirname(bin), { recursive: true });
    symlinkSync(real, bin);
    expect(launchOf(bin)).toEqual({ kind: 'installed', script: realpathSync(real) });
  });
});

describe('uninstall', () => {
  test('a file this CLI created is taken away again, not left empty', () => {
    for (const integration of INTEGRATIONS) {
      install(integration, false, NPX);
      expect(uninstall(integration, false).action, integration.id).toBe('removed');
      expect(isInstalled(integration), integration.id).toBe(false);
    }
  });

  test('a file the person already had comes back byte for byte', () => {
    const path = configFileFor(claude);
    const original = `${JSON.stringify(
      {
        model: 'opus',
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello' }] }] },
        permissions: { allow: ['Bash(ls:*)'] },
      },
      null,
      '\t',
    )}\n`;
    seed(path, original);

    install(claude, false, NPX);
    expect(bytesOf(path)).not.toBe(original);
    expect(bytesOf(path)).toContain('pixelhof beat');
    expect(bytesOf(path)).toContain('echo hello');
    expect(bytesOf(path)).toMatch(/\n\t"model"/);

    expect(uninstall(claude, false).action).toBe('written');
    expect(bytesOf(path)).toBe(original);
  });

  test('a hand-formatted file keeps its indentation, and everything it said', () => {
    const path = configFileFor(claude);
    const original = '{\n\t"model": "opus",\n\t"permissions": { "allow": ["Bash(ls:*)"] }\n}\n';
    seed(path, original);
    const before = JSON.parse(original);

    install(claude, false, NPX);
    uninstall(claude, false);

    // A round trip through JSON.parse cannot put back where a person chose to
    // break their lines, so the file comes back laid out the way JSON.stringify
    // lays it out, in the indentation it was found in, saying the same thing.
    expect(JSON.parse(bytesOf(path))).toEqual(before);
    expect(bytesOf(path)).toMatch(/\n\t"model"/);
  });

  test('a file with no entries of ours is left exactly alone', () => {
    const path = configFileFor(claude);
    const original = '{\n  "model": "opus"\n}\n';
    seed(path, original);
    expect(uninstall(claude, false).action).toBe('absent');
    expect(bytesOf(path)).toBe(original);
  });

  test('an agent that was never installed reports nothing to remove', () => {
    expect(uninstall(claude, false).action).toBe('absent');
  });

  test('a dry run reports the removal and removes nothing', () => {
    install(claude, false, NPX);
    expect(uninstall(claude, true).action).toBe('removed');
    expect(isInstalled(claude)).toBe(true);
  });

  test('an entry left by an older version is removed even under a stale event name', () => {
    const path = configFileFor(claude);
    seed(
      path,
      JSON.stringify(
        {
          model: 'opus',
          hooks: {
            SubagentStop: [{ hooks: [{ command: 'npx -y pixelhof beat --agent claude-code' }] }],
          },
        },
        null,
        2,
      ) + '\n',
    );
    expect(uninstall(claude, false).action).toBe('written');
    expect(JSON.parse(bytesOf(path))).toEqual({ model: 'opus' });
  });
});

describe('a relocated agent', () => {
  test('Claude Code under CLAUDE_CONFIG_DIR gets its hook in that directory, not in ~/.claude', () => {
    const elsewhere = join(home, 'second-account');
    process.env['CLAUDE_CONFIG_DIR'] = elsewhere;
    expect(configFileFor(claude)).toBe(join(elsewhere, 'settings.json'));
    install(claude, false, NPX);
    expect(existsSync(join(elsewhere, 'settings.json'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false);
    expect(isInstalled(claude)).toBe(true);
  });

  test('an empty CLAUDE_CONFIG_DIR means the default directory', () => {
    process.env['CLAUDE_CONFIG_DIR'] = '  ';
    expect(configFileFor(claude)).toBe(join(home, '.claude', 'settings.json'));
  });
});
