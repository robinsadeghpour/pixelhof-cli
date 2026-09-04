import { Command } from 'commander';
import { ApiError, fetchMyWork } from './lib/api.js';
import { clearConfig, configPath, needsLogin, readConfig, resolveUrl, writeConfig } from './lib/config.js';
import { DeviceError, deviceLogin, openBrowser } from './lib/device.js';
import { type Change, beatCommand, configFileFor, install, isInstalled, uninstall } from './lib/install.js';
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
  const place = work.rank === null ? 'not on the board yet' : `${work.rank} on the board`;
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
  for (const integration of INTEGRATIONS) {
    const state = isInstalled(integration) ? 'installed' : 'not installed';
    const caveat = integration.verified ? '' : '  (schema unverified, see the README)';
    say(`  ${integration.label.padEnd(12)} ${state.padEnd(14)} ${configFileFor(integration)}${caveat}`);
  }
  say();
  say(`Hooks run: ${beatCommand('<agent>')}`);
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
      reportChanges(
        targets.map((i) => install(i, options.dryRun)),
        options.dryRun,
      );
      say();
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
