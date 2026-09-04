import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { hasBeats, isOnlyBase, withBeats, withoutBeats } from './hooks.js';
import type { Integration } from './integrations.js';
import { readJsonFile, removeFile, renderJsonFile, writeJsonFile } from './json-file.js';

/**
 * Writing the hook entries to disk, and taking them off again.
 *
 * The decision every step makes is the same one: change nothing that this CLI
 * did not put there. So the file is compared as rendered text before anything
 * is written, which is what makes a second install report `unchanged` honestly
 * rather than rewriting a file to the same bytes and calling it work.
 */

export type Action = 'written' | 'unchanged' | 'removed' | 'absent';

export type Change = {
  id: string;
  label: string;
  path: string;
  action: Action;
  verified: boolean;
};

export const configFileFor = (
  integration: Integration,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const dir = integration.configDirEnv ? env[integration.configDirEnv]?.trim() : undefined;
  return dir ? join(dir, basename(integration.file)) : join(homedir(), integration.file);
};

/**
 * How this CLI was started, which is what decides the command it writes.
 *
 * A hook installed as `npx -y pixelhof beat` makes npx resolve the package
 * again on every tool call: a registry check and a few hundred milliseconds,
 * hundreds of times an hour, for a file already on the disk. So an install that
 * can name a real file names it, and only a run out of npx's own cache writes
 * the npx form, because that copy is temporary and will not be there tomorrow.
 */
export type Launch = { kind: 'installed'; script: string } | { kind: 'npx' };

/** npm's cache for packages it fetched to run once. */
const NPX_CACHE = '_npx';

export function launchOf(argv1: string | undefined = process.argv[1]): Launch {
  if (argv1 === undefined) return { kind: 'npx' };
  let script: string;
  try {
    script = realpathSync(argv1);
  } catch {
    return { kind: 'npx' };
  }
  // Node runs the file, so a file node cannot run is no use in a hook. This is
  // what sends a `tsx src/index.ts` run down the npx path.
  if (!script.endsWith('.js')) return { kind: 'npx' };
  return script.split(sep).includes(NPX_CACHE) ? { kind: 'npx' } : { kind: 'installed', script };
}

const viaNpx = (agentId: string): string => `npx -y pixelhof beat --agent ${agentId}`;

/**
 * The command the hook will run. Both paths are quoted, because a home
 * directory with a space in it is somebody's ordinary Tuesday.
 */
export function beatCommand(agentId: string, launch: Launch = launchOf()): string {
  if (launch.kind === 'npx') return viaNpx(agentId);
  const direct = `"${process.execPath}" "${launch.script}" beat --agent ${agentId}`;
  // An entry `uninstall` could not find again is worse than a slow one, so a
  // command that does not carry both markers is not written at all.
  return hasBeats(direct) ? direct : viaNpx(agentId);
}

export function install(integration: Integration, dryRun: boolean, launch = launchOf()): Change {
  const path = configFileFor(integration);
  const file = readJsonFile(path);
  const next = withBeats(file.doc, integration, beatCommand(integration.id, launch));
  const unchanged = file.existed && renderJsonFile(file, next) === renderJsonFile(file, file.doc);
  if (!unchanged && !dryRun) writeJsonFile(file, next);
  return {
    id: integration.id,
    label: integration.label,
    path,
    action: unchanged ? 'unchanged' : 'written',
    verified: integration.verified,
  };
}

export function uninstall(integration: Integration, dryRun: boolean): Change {
  const path = configFileFor(integration);
  const file = readJsonFile(path);
  if (!file.existed || !hasBeats(file.doc)) {
    return {
      id: integration.id,
      label: integration.label,
      path,
      action: 'absent',
      verified: integration.verified,
    };
  }
  const pruned = withoutBeats(file.doc);
  // A file left holding nothing but the version stanza its format demands
  // declares no hooks at all, so it goes rather than sitting there as litter.
  const empty = pruned === undefined || isOnlyBase(pruned, integration);
  if (!dryRun) {
    if (empty) removeFile(path);
    else writeJsonFile(file, pruned);
  }
  return {
    id: integration.id,
    label: integration.label,
    path,
    action: empty ? 'removed' : 'written',
    verified: integration.verified,
  };
}

/** Whether this CLI's entries are in an agent's config right now. */
export function isInstalled(integration: Integration): boolean {
  const file = readJsonFile(configFileFor(integration));
  return file.existed && hasBeats(file.doc);
}
