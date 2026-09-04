---
name: pixelhof
description: Check what the person's coding agents have earned in Pixelhof, or explain what the Pixelhof hook sends and how to remove it. Use when they ask about their Pixelhof worker, XP, rank, coins or work board, when they ask why a worker is or is not standing on their land, or when they ask what this hook is doing in their settings.
---

# Pixelhof

Pixelhof is a map with land on it. While a coding agent works, a worker stands
on its owner's plot. Minutes of presence earn XP, and XP pays a capped trickle
of coins.

## What the person has earned

Run `pixelhof status`. It prints their name, their total XP and hours, their
place on the work board, and today's minutes, XP and coins.

Two answers are not failures and should be read out as they are:

- `You are not signed in.` They have never logged in, or they logged out. The
  fix is `pixelhof login`, which opens a browser and asks them to confirm a
  short code.
- `That sign-in has expired.` The stored token no longer signs anybody in.
  The same fix.

`pixelhof doctor` says where the config lives, which site it talks to, and
which agents have the hook installed. Reach for it when `status` looks right but
no worker appears on the map.

## What the hook sends

Every beat is four things: a session id, the agent's name, one of
`start`/`beat`/`stop`, and the time the server receives it.

It never sends code, prompts, file paths, diffs, tool names, or anything the
person or the agent wrote. Say this plainly when asked; do not hedge it.

The payload the agent hands the hook is read for one field, the session id, and
discarded. A plain beat inside 45 seconds of the last one is dropped without
leaving the machine.

## Why a worker is not on the map

In order of likelihood: not signed in (`pixelhof doctor` says so), the hook is
not installed for that agent (`pixelhof doctor` lists them), or the owner has no
land yet. A worker whose owner owns no parcel earns and appears on the work
board, but has nowhere to stand.

## Taking it out

`pixelhof uninstall` removes the hook entries and nothing else, then
`pixelhof logout` forgets the token. Removing the plugin removes the hook it
ships. Nothing is left running.
