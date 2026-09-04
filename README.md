# pixelhof

Pixelhof is a map with land on it. Connect a coding agent and, while it works, a
worker stands on your plot. Minutes of presence earn XP, XP fills a work board,
and a capped trickle of coins lands in your wallet.

This is the part that runs on your machine: a hook that tells the site your
agent is at it, and a handful of commands to set it up and check on it.

## Getting started

```
npx pixelhof login
npx pixelhof install
```

`login` opens your browser and shows a short code to confirm. `install` adds a
hook to every coding agent it can find a config for. Then work as you normally
would.

```
pixelhof status
```

```
Robin Faraj
1,240 XP, 18 h, 3 on the board
Today: 34 min, 34 XP, 5 coins
```

## What is sent

Every beat is four things:

| | |
|---|---|
| session id | the id your agent already gives its own hooks, or a hash of the working directory when it gives none |
| agent name | `claude-code`, `codex`, `gemini`, `cursor`, `opencode` or `other` |
| event | `start`, `beat` or `stop` |
| time | when the server receives it |

Nothing else leaves your machine. Not your code, not your prompts, not your file
paths, not the names of the tools your agent ran, not a token count. The payload
your agent hands the hook is read for one field and discarded.

A plain beat within 45 seconds of the last one for that session is dropped
before it leaves the machine, so a busy hour is a few dozen small requests and
not a few thousand. A `start` and a `stop` are always sent. Every request gives
up after two seconds, and the hook exits quietly whatever happens: a site that
is slow or down is not going to cost you a keystroke.

The token `login` stores is a session token. It lives in
`~/.pixelhof/config.json`, in a directory only you can open, in a file only you
can read.

## Commands

| | |
|---|---|
| `pixelhof login [--url <base>]` | sign in through your browser and store the token |
| `pixelhof logout` | forget the stored token |
| `pixelhof status` | what your agents have earned |
| `pixelhof install [--agent <id>] [--dry-run]` | add the hook to an agent's config |
| `pixelhof uninstall [--agent <id>] [--dry-run]` | take it back out |
| `pixelhof doctor` | where everything is, and what is set up |
| `pixelhof beat --agent <id>` | what the hook itself runs |

`--agent` takes `claude-code`, `codex`, `gemini`, `cursor` or `all`, and
defaults to `all`. `--dry-run` prints what would change and changes nothing.

Set `PIXELHOF_URL` to point every command at a different site.

## Where the hook goes

| agent | file | events |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `SessionStart`, `PostToolUse`, `Stop`, `SessionEnd` |
| Codex | `~/.codex/hooks.json` | `SessionStart`, `PostToolUse`, `Stop`, `SessionEnd` |
| Gemini CLI | `~/.gemini/settings.json` | `SessionStart`, `AfterTool`, `AfterAgent`, `SessionEnd` |
| Cursor | `~/.cursor/hooks.json` | `sessionStart`, `postToolUse`, `stop`, `sessionEnd` |

Claude Code's, Codex's and Cursor's shapes were read off each vendor's own hooks
reference. **Gemini CLI's was not.** The only reference found for it is a
community-run site rather than a Google one, so treat that row as a best reading
and check the file after installing. Every command that touches it says so.

Installing twice is installing once. The installer parses the file you already
have, adds its entries, and writes it back with the indentation it found; it
never replaces a file wholesale and never touches an entry that is not its own.
A file that is not valid JSON is refused rather than guessed at.

One honest limit: a round trip through `JSON.parse` cannot put back where you
chose to break your own lines. A file already laid out the way `JSON.stringify`
lays one out comes back byte for byte after an install and an uninstall. A
hand-formatted one comes back saying exactly what it said, in the indentation it
was found in, on lines of this tool's choosing.

## As a Claude Code plugin

```
/plugin marketplace add robinfaraj/pixelhof-cli
/plugin install pixelhof
```

The plugin ships the same hook and a skill that tells Claude how to read
`pixelhof status` and what the hook sends. You still need `npx pixelhof login`
once, and you do not need `pixelhof install` as well.

## Removing it

```
pixelhof uninstall
pixelhof logout
```

`uninstall` removes only the entries whose command runs `pixelhof beat`, and
leaves everything else in the file exactly as it was. An entry an older version
put somewhere else is removed too. A file that held nothing but these entries is
deleted rather than left behind empty.

`logout` deletes `~/.pixelhof/config.json`. To be rid of the last of it, remove
`~/.pixelhof` and the worker stops appearing.

## Building it

```
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Licence

MIT. See [LICENSE](./LICENSE).
