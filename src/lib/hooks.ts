import type { Integration } from './integrations.js';

/**
 * Putting this CLI into somebody's hooks and taking it out again.
 *
 * Both directions are pure functions on the parsed document, so a test can
 * assert the round trip without a disk, and the caller decides what reaches the
 * file. An entry of ours is recognised by the command string it runs and by
 * nothing else, which is why the marker is a constant rather than a comment or
 * a key nobody else would think to look for.
 */

/**
 * What says an entry belongs to this CLI: the package's name, and the
 * subcommand only this CLI has. Both, because either alone is too eager.
 *
 * Two commands run the same beat. One names the package (`npx -y pixelhof
 * beat`), the other names the file the package installed (`"/…/node"
 * "/…/pixelhof/dist/index.js" beat`). A single substring cannot catch both, so
 * the marker is the pair they share, and an entry is ours only if it carries
 * each.
 */
export const BEAT_MARKERS = ['pixelhof', 'beat --agent'] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOurs = (entry: unknown): boolean => {
  const text = JSON.stringify(entry ?? null);
  return BEAT_MARKERS.every((marker) => text.includes(marker));
};

export function beatCommands(node: unknown): string[] {
  if (Array.isArray(node)) return [...new Set(node.flatMap(beatCommands))];
  if (!isObject(node)) return [];
  const commands = Object.values(node).flatMap(beatCommands);
  if (typeof node['command'] === 'string' && isOurs(node['command'])) {
    commands.unshift(node['command']);
  }
  return [...new Set(commands)];
}

/**
 * The document with this CLI's entries put in.
 *
 * Installing twice is installing once: every placement drops whatever of ours
 * was already at that key before adding the current entry, so a re-run after an
 * upgrade replaces the old command instead of stacking a second one.
 */
export function withBeats(doc: unknown, integration: Integration, command: string): unknown {
  const next: Record<string, unknown> = isObject(doc) ? structuredClone(doc) : {};
  for (const [key, value] of Object.entries(integration.base)) {
    if (!(key in next)) next[key] = value;
  }
  for (const placement of integration.placements(command)) {
    const [head, ...rest] = placement.path;
    if (head === undefined) continue;
    let cursor = next;
    for (const key of [head, ...rest].slice(0, -1)) {
      const child = cursor[key];
      cursor[key] = isObject(child) ? child : {};
      cursor = cursor[key] as Record<string, unknown>;
    }
    const leaf = placement.path[placement.path.length - 1] as string;
    const existing = cursor[leaf];
    const others = Array.isArray(existing) ? existing.filter((entry) => !isOurs(entry)) : [];
    cursor[leaf] = [...others, placement.entry];
  }
  return next;
}

/**
 * The document with this CLI's entries taken out, or `undefined` when nothing
 * of anybody's is left.
 *
 * Only list entries are ever this CLI's, so the marker is tested against list
 * items alone. Testing it against a whole event would take a person's other
 * hooks down with ours. A list or an object the pruning empties is dropped, so a
 * file that held nothing but this CLI comes back exactly as it was before.
 */
export function withoutBeats(node: unknown): unknown {
  if (Array.isArray(node)) {
    const kept = node
      .filter((entry) => !isOurs(entry))
      .map(withoutBeats)
      .filter((entry) => entry !== undefined);
    return kept.length === 0 && node.length > 0 ? undefined : kept;
  }
  if (isObject(node)) {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const pruned = withoutBeats(value);
      if (pruned !== undefined) kept[key] = pruned;
    }
    return Object.keys(kept).length === 0 && Object.keys(node).length > 0 ? undefined : kept;
  }
  return node;
}

/** True when the document is nothing but the keys this CLI adds to a file it created. */
export function isOnlyBase(doc: unknown, integration: Integration): boolean {
  if (!isObject(doc)) return false;
  const keys = Object.keys(doc);
  const baseKeys = Object.keys(integration.base);
  return (
    keys.length === baseKeys.length &&
    baseKeys.every((key) => JSON.stringify(doc[key]) === JSON.stringify(integration.base[key]))
  );
}

/** True when an entry of this CLI's sits anywhere in the document. */
export const hasBeats = (doc: unknown): boolean => isOurs(doc);
