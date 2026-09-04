import { describe, expect, test } from 'vitest';
import { hasBeats, isOnlyBase, withBeats, withoutBeats } from '../src/lib/hooks.js';
import { INTEGRATIONS, eventFor, integrationFor } from '../src/lib/integrations.js';

const COMMAND = 'pixelhof beat --agent claude-code';
const claude = integrationFor('claude-code')!;
const cursor = integrationFor('cursor')!;

describe('installing into a document', () => {
  test('a second install leaves the same document as the first', () => {
    for (const integration of INTEGRATIONS) {
      const once = withBeats({}, integration, COMMAND);
      const twice = withBeats(once, integration, COMMAND);
      expect(twice, integration.id).toEqual(once);
    }
  });

  test('an upgraded command replaces the old entry rather than stacking on it', () => {
    const old = withBeats({}, claude, 'npx -y pixelhof beat --agent claude-code');
    const fresh = withBeats(old, claude, COMMAND);
    const groups = (fresh as { hooks: { SessionStart: unknown[] } }).hooks.SessionStart;
    expect(groups).toHaveLength(1);
    expect(JSON.stringify(groups)).toContain(COMMAND);
    expect(JSON.stringify(groups)).not.toContain('npx -y');
  });

  test("somebody else's hook on the same event survives an install", () => {
    const theirs = {
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
    };
    const merged = withBeats(theirs, claude, COMMAND);
    const groups = (merged as { hooks: { SessionStart: unknown[] } }).hooks.SessionStart;
    expect(groups).toHaveLength(2);
    expect(JSON.stringify(groups[0])).toContain('echo mine');
  });

  test('a file this CLI creates carries the keys its format requires', () => {
    expect(withBeats({}, cursor, COMMAND)).toMatchObject({ version: 1 });
  });
});

describe('taking the entries out again', () => {
  test('a document with nothing else in it prunes away to nothing', () => {
    for (const integration of INTEGRATIONS) {
      const installed = withBeats({}, integration, COMMAND);
      const pruned = withoutBeats(installed);
      const empty = pruned === undefined || isOnlyBase(pruned, integration);
      expect(empty, integration.id).toBe(true);
    }
  });

  test('an install and an uninstall leave the rest of the document untouched', () => {
    const theirs = {
      model: 'opus',
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
      permissions: { allow: ['Bash(ls:*)'] },
    };
    const round = withoutBeats(withBeats(theirs, claude, COMMAND));
    expect(round).toEqual(theirs);
  });

  test('an event that held only this CLI is dropped, not left empty', () => {
    const installed = withBeats({ model: 'opus' }, claude, COMMAND);
    expect(withoutBeats(installed)).toEqual({ model: 'opus' });
  });

  test('an entry is recognised by its command and not by where it sits', () => {
    const stale = { hooks: { Notification: [{ hooks: [{ command: 'pixelhof beat --agent x' }] }] } };
    expect(hasBeats(stale)).toBe(true);
    expect(withoutBeats(stale)).toBeUndefined();
  });

  test('a document this CLI never touched is left alone', () => {
    const theirs = { model: 'opus', hooks: { Stop: [{ hooks: [{ command: 'echo bye' }] }] } };
    expect(withoutBeats(theirs)).toEqual(theirs);
    expect(hasBeats(theirs)).toBe(false);
  });
});

describe('the event each agent reports', () => {
  test('every agent names a start and a stop, and nothing else', () => {
    for (const integration of INTEGRATIONS) {
      const meanings = Object.values(integration.events);
      expect(meanings, integration.id).toContain('start');
      expect(meanings, integration.id).toContain('stop');
    }
  });

  test.each([
    ['claude-code', 'SessionStart', 'start'],
    ['claude-code', 'SessionEnd', 'stop'],
    ['claude-code', 'PostToolUse', 'beat'],
    ['claude-code', 'Stop', 'beat'],
    ['claude-code', 'UserPromptSubmit', 'beat'],
    ['codex', 'SessionStart', 'start'],
    ['codex', 'SessionEnd', 'stop'],
    ['codex', 'PreToolUse', 'beat'],
    ['gemini', 'SessionStart', 'start'],
    ['gemini', 'SessionEnd', 'stop'],
    ['gemini', 'AfterTool', 'beat'],
    ['cursor', 'sessionStart', 'start'],
    ['cursor', 'sessionEnd', 'stop'],
    ['cursor', 'afterFileEdit', 'beat'],
  ])('%s reports %s as %s', (agent, raw, expected) => {
    expect(eventFor(integrationFor(agent), raw)).toBe(expected);
  });

  test('an agent with no hook table of its own still beats', () => {
    expect(eventFor(integrationFor('opencode'), 'whatever')).toBe('beat');
    expect(eventFor(undefined, 'SessionStart')).toBe('beat');
  });

  test("Claude Code's end of turn is a beat, because the session is still open", () => {
    expect(eventFor(claude, 'Stop')).toBe('beat');
    expect(eventFor(claude, 'SessionEnd')).toBe('stop');
  });
});
