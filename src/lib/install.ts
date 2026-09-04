import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
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

export const configFileFor = (integration: Integration): string =>
  join(homedir(), integration.file);

/**
 * The command the hook will run.
 *
 * A globally installed binary is preferred because it costs a process start; a
 * fallback through `npx` costs a registry check on a machine that has no copy.
 * Both end at the same `beat`, so an entry stays recognisable either way.
 */
export function beatCommand(agentId: string, onPath = isOnPath('pixelhof')): string {
  return `${onPath ? 'pixelhof' : 'npx -y pixelhof'} beat --agent ${agentId}`;
}

export function isOnPath(binary: string): boolean {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir === '') continue;
    try {
      accessSync(join(dir, binary), constants.X_OK);
      return true;
    } catch {
      // Not here; try the next one.
    }
  }
  return false;
}

export function install(integration: Integration, dryRun: boolean): Change {
  const path = configFileFor(integration);
  const file = readJsonFile(path);
  const next = withBeats(file.doc, integration, beatCommand(integration.id));
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
