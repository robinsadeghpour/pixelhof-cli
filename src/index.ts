#!/usr/bin/env node

/**
 * Two programs share this file.
 *
 * One runs when a person types a command and can afford an argument parser.
 * The other runs after every tool call an agent makes, and cannot. The beat is
 * dispatched off `process.argv` before a single other module is named, so the
 * hook path loads its own three small files and nothing else. Moving the check
 * below an import of commander would put an argument parser in the latency of
 * every tool call on the machine, so it stays first.
 */

if (process.argv[2] === 'beat') {
  const { runBeat } = await import('./beat.js');
  await runBeat(process.argv.slice(3));
  process.exit(0);
}

const { main } = await import('./cli.js');
await main(process.argv);
