import type { AgentId, BeatEvent } from './agents.js';

/**
 * The agents whose hooks this CLI can install itself into, as a table.
 *
 * Every one of them answers the same four questions: which file holds its
 * hooks, what a command entry looks like in it, which of its event names mean
 * what to the map, and which key in its payload carries the session. Keeping
 * that as data rather than a branch per agent means a fifth agent is a row.
 *
 * `verified` says the shape below was read off the vendor's own reference. An
 * unverified row is a best reading of a community page and is named as such in
 * the README, because a wrong shape here silently writes rubbish into somebody
 * else's settings.
 */

export type InstallableAgentId = Extract<AgentId, 'claude-code' | 'codex' | 'gemini' | 'cursor'>;

/** Where one hook entry goes: the keys to walk, and the entry to put in the array there. */
export type Placement = { path: string[]; entry: unknown };

export type Integration = {
  id: InstallableAgentId;
  label: string;
  /** Relative to the home directory, so a temp HOME redirects the whole install. */
  file: string;
  verified: boolean;
  /** Keys the file must carry when this CLI is the one creating it. */
  base: Record<string, unknown>;
  /** The vendor's event name to what it means to the map. Anything absent is a `beat`. */
  events: Record<string, BeatEvent>;
  /** Payload keys that may hold the session id, tried in order. */
  sessionKeys: string[];
  placements(command: string): Placement[];
};

/**
 * Claude Code, Codex and Gemini all nest a command under an event: the event
 * holds a list of match groups, and a group holds a list of handlers. One
 * group of ours per event, so removing the group removes exactly this CLI.
 */
const nested = (event: string, handler: unknown): Placement => ({
  path: ['hooks', event],
  entry: { hooks: [handler] },
});

export const INTEGRATIONS: readonly Integration[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    file: '.claude/settings.json',
    verified: true,
    base: {},
    events: {
      SessionStart: 'start',
      SessionEnd: 'stop',
      PostToolUse: 'beat',
      Stop: 'beat',
    },
    sessionKeys: ['session_id'],
    placements: (command) =>
      ['SessionStart', 'PostToolUse', 'Stop', 'SessionEnd'].map((event) =>
        nested(event, { type: 'command', command, async: true }),
      ),
  },
  {
    id: 'codex',
    label: 'Codex',
    file: '.codex/hooks.json',
    verified: true,
    base: {},
    events: {
      SessionStart: 'start',
      SessionEnd: 'stop',
      PostToolUse: 'beat',
      Stop: 'beat',
    },
    sessionKeys: ['session_id'],
    placements: (command) =>
      ['SessionStart', 'PostToolUse', 'Stop', 'SessionEnd'].map((event) =>
        nested(event, { type: 'command', command }),
      ),
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    file: '.gemini/settings.json',
    verified: false,
    base: {},
    events: {
      SessionStart: 'start',
      SessionEnd: 'stop',
      AfterTool: 'beat',
      AfterAgent: 'beat',
    },
    sessionKeys: ['session_id'],
    placements: (command) =>
      ['SessionStart', 'AfterTool', 'AfterAgent', 'SessionEnd'].map((event) =>
        nested(event, { name: 'pixelhof', type: 'command', command, timeout: 5000 }),
      ),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    file: '.cursor/hooks.json',
    verified: true,
    // Cursor's file is versioned, and its entries sit straight under the event
    // rather than in a match group.
    base: { version: 1 },
    events: {
      sessionStart: 'start',
      sessionEnd: 'stop',
      postToolUse: 'beat',
      stop: 'beat',
    },
    sessionKeys: ['conversation_id', 'session_id'],
    placements: (command) =>
      ['sessionStart', 'postToolUse', 'stop', 'sessionEnd'].map((event) => ({
        path: ['hooks', event],
        entry: { command },
      })),
  },
];

export const integrationFor = (id: string): Integration | undefined =>
  INTEGRATIONS.find((i) => i.id === id);

/** What the agent's event name means to the map. Unknown names are ordinary beats. */
export const eventFor = (integration: Integration | undefined, raw: unknown): BeatEvent => {
  if (integration === undefined || typeof raw !== 'string') return 'beat';
  return integration.events[raw] ?? 'beat';
};
