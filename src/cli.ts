import { Command } from 'commander';
import { ApiError, fetchMyWork } from './lib/api.js';
import { clearConfig, configPath, needsLogin, readConfig, resolveUrl, writeConfig } from './lib/config.js';
import { DeviceError, deviceLogin, openBrowser } from './lib/device.js';
import {
  type Change,
  configFileFor,
  configuredCommands,
  install,
  launchOf,
  uninstall,
} from './lib/install.js';
import { INTEGRATIONS, type Integration } from './lib/integrations.js';

/**
 * The half a person types.
 *
 * Every line here is read by somebody at a prompt who wants to know one of two
 * things: is it working, and what do I do next. So a refusal always names the
 * command that fixes it, and nothing is reported as done that was not done.
 */

const say = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

const AGENT_CHOICES = [...INTEGRATIONS.map((i) => i.id), 'all'];

const chosen = (agent: string): readonly Integration[] =>
  agent === 'all' ? INTEGRATIONS : INTEGRATIONS.filter((i) => i.id === agent);

const hours = (minutes: number): string =>
  minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;

function codexTrustGuidance(): void {
  say('Codex: open `codex`, run `/hooks`, and review/trust the exact Pixelhof hook definitions.');
  say('  Codex must trust them before they can send activity. Trust cannot be verified from hooks.json.');
  say('  Changing a hook command requires another review. Use the same CODEX_HOME as your Codex app.');
  say('  Start a fresh Codex session after review so SessionStart can run.');
}

/** 1st, 2nd, 3rd, and the teens that break the pattern. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function reportChanges(changes: readonly Change[], dryRun: boolean): void {
  for (const change of changes) {
    const note =
      change.action === 'written'
        ? dryRun
          ? 'would write'
          : 'written'
        : change.action === 'removed'
          ? dryRun
            ? 'would remove'
            : 'removed'
          : change.action === 'unchanged'
            ? 'already there'
            : 'nothing to remove';
    const caveat = change.verified ? '' : '  (schema unverified, see the README)';
    say(`  ${change.label.padEnd(12)} ${note.padEnd(18)} ${change.path}${caveat}`);
  }
}

async function runLogin(options: { url?: string }): Promise<void> {
  const url = resolveUrl(options.url);
  say(`Signing in to ${url}`);
  const token = await deviceLogin(url, {
    print: say,
    open: openBrowser,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  });
  writeConfig({ url, token });
  say(`Signed in. The token is in ${configPath()}, readable only by you.`);
}

async function runStatus(): Promise<void> {
  const config = readConfig();
  if (config === null) {
    say('You are not signed in. Run `pixelhof login`.');
    return;
  }
  const work = await fetchMyWork(config);
  if (work === null) {
    say('That sign-in has expired. Run `pixelhof login` again.');
    return;
  }
  const place = work.rank === null ? 'not on the board yet' : `${ordinal(work.rank)} on the board`;
  say(work.name);
  say(`${work.xp.toLocaleString('en-GB')} XP, ${hours(work.minutes)}, ${place}`);
  say(`Today: ${work.today.minutes} min, ${work.today.xp} XP, ${work.today.taler} coins`);
  if (work.working > 0) {
    say(`${work.working} ${work.working === 1 ? 'worker is' : 'workers are'} on your land now.`);
  }
}

function runDoctor(): void {
  const config = readConfig();
  const account =
    config === null
      ? 'not signed in, run `pixelhof login`'
      : needsLogin()
        ? 'the token has expired, run `pixelhof login` again'
        : 'signed in';
  say(`Config   ${configPath()}`);
  say(`Site     ${resolveUrl()}`);
  say(`Account  ${account}`);
  say();
  say('Hooks');
  let usesNpx = false;
  let codexConfigured = false;
  for (const integration of INTEGRATIONS) {
    const commands = configuredCommands(integration);
    const state = commands.length > 0 ? 'configured' : 'not configured';
    const caveat = integration.verified ? '' : '  (schema unverified, see the README)';
    say(`  ${integration.label.padEnd(12)} ${state.padEnd(14)} ${configFileFor(integration)}${caveat}`);
    for (const command of commands) {
      say(`    ${command}`);
      if (/\bnpx\b/.test(command)) usesNpx = true;
    }
    if (integration.id === 'codex' && commands.length > 0) codexConfigured = true;
  }
  say();
  say('Configured means the commands above are saved; it does not confirm they are running.');
  if (usesNpx) {
    say('  Some saved hooks use npx, which resolves the package again on every call.');
    say('  `npm i -g pixelhof && pixelhof install` writes a direct path instead.');
  }
  if (codexConfigured) {
    say();
    codexTrustGuidance();
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const program = new Command();
  program
    .name('pixelhof')
    .description('Put your coding agent to work on your land in Pixelhof.')
    .showHelpAfterError();

  program
    .command('login')
    .description('sign in through your browser and store the token')
    .option('--url <base>', 'the Pixelhof site to sign in to')
    .action(runLogin);

  program
    .command('logout')
    .description('forget the stored token')
    .action(() => {
      clearConfig();
      say('Signed out.');
    });

  program.command('status').description("show what your agents have earned").action(runStatus);

  program
    .command('install')
    .description("add the hook to a coding agent's config")
    .option('--agent <id>', `which agent (${AGENT_CHOICES.join(', ')})`, 'all')
    .option('--dry-run', 'say what would change and change nothing', false)
    .action((options: { agent: string; dryRun: boolean }) => {
      const targets = chosen(options.agent);
      if (targets.length === 0) {
        program.error(`No agent called ${options.agent}. Try one of ${AGENT_CHOICES.join(', ')}.`);
      }
      const launch = launchOf();
      reportChanges(
        targets.map((i) => install(i, options.dryRun, launch)),
        options.dryRun,
      );
      say();
      if (launch.kind === 'npx') {
        say('That hook goes through npx, which looks the package up again on every');
        say('tool call. `npm i -g pixelhof && pixelhof install` writes a direct path');
        say('instead, and the hook stops costing anything worth measuring.');
        say();
      }
      if (targets.some((integration) => integration.id === 'codex')) {
        codexTrustGuidance();
        say();
      }
      say('The hook sends a session id, the agent name, the event and the time.');
      say('Never your code, your prompts or your paths.');
    });

  program
    .command('uninstall')
    .description('take the hook back out')
    .option('--agent <id>', `which agent (${AGENT_CHOICES.join(', ')})`, 'all')
    .option('--dry-run', 'say what would change and change nothing', false)
    .action((options: { agent: string; dryRun: boolean }) => {
      const targets = chosen(options.agent);
      if (targets.length === 0) {
        program.error(`No agent called ${options.agent}. Try one of ${AGENT_CHOICES.join(', ')}.`);
      }
      reportChanges(
        targets.map((i) => uninstall(i, options.dryRun)),
        options.dryRun,
      );
    });

  program.command('doctor').description('show where everything is and what is set up').action(runDoctor);

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (error instanceof ApiError || error instanceof DeviceError) {
      say((error as Error).message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
