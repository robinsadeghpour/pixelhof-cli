/**
 * The agents a worker can be, and what a beat says about them.
 *
 * The ids mirror the `AGENTS` registry the Pixelhof server keeps, so a string
 * written here lands on the map as the villager that server draws. Anything the
 * list does not name is `other` rather than refused: a new agent should be able
 * to stand on the map the day it exists.
 */

export const AGENT_IDS = ['claude-code', 'codex', 'gemini', 'cursor', 'opencode', 'other'] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export const isAgentId = (id: string): id is AgentId =>
  (AGENT_IDS as readonly string[]).includes(id);

export const agentFor = (raw: string | null | undefined): AgentId =>
  typeof raw === 'string' && isAgentId(raw) ? raw : 'other';

/**
 * What a beat tells the server about the shift. `start` opens one, `stop` ends
 * it, and `beat` says the agent is still at it. A shift that only ever beats is
 * still counted, so a missed `start` costs nothing.
 */
export type BeatEvent = 'start' | 'beat' | 'stop';

export type Beat = {
  agent: AgentId;
  sessionId: string;
  event: BeatEvent;
};

/** How long the throttle holds a plain `beat` back. `start` and `stop` ignore it. */
export const BEAT_THROTTLE_MS = 45_000;

/** How long the CLI waits on the server before giving up and exiting quietly. */
export const BEAT_TIMEOUT_MS = 2_000;

/** The longest session id the server takes, so a long one is trimmed not refused. */
export const MAX_SESSION_ID = 200;
