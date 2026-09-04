import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Reading and writing somebody else's settings file.
 *
 * The file belongs to the person, not to this CLI, so it goes back out shaped
 * the way it came in: the same indentation, the same trailing newline. That is
 * what lets an uninstall leave a file the installer touched byte for byte as it
 * was found, which is the only promise that makes writing to it defensible.
 */

export type JsonFile = {
  path: string;
  /** False when the file is absent, so an uninstall knows to leave nothing behind. */
  existed: boolean;
  doc: unknown;
  indent: string;
  trailingNewline: boolean;
};

/** The indentation of the first indented line, so a tab file stays a tab file. */
function indentOf(text: string): string {
  const match = /\n([ \t]+)\S/.exec(text);
  return match?.[1] ?? '  ';
}

export function readJsonFile(path: string): JsonFile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { path, existed: false, doc: {}, indent: '  ', trailingNewline: true };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON, so nothing was written to it.`);
  }
  return {
    path,
    existed: true,
    doc,
    indent: indentOf(text),
    trailingNewline: text.endsWith('\n'),
  };
}

export function renderJsonFile(file: JsonFile, doc: unknown): string {
  return JSON.stringify(doc, null, file.indent) + (file.trailingNewline ? '\n' : '');
}

export function writeJsonFile(file: JsonFile, doc: unknown): void {
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, renderJsonFile(file, doc), 'utf8');
}

export function removeFile(path: string): void {
  rmSync(path, { force: true });
}
