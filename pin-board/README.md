# pin-board

Pin standing notes with `/pin`. Claude keeps following them after `/compact` and `/clear`, and you see them above the prompt. Pins you keep come back after a restart.

## Use

- `/pin <note>`: pins a note.
- `/pin <note> --keep`: pins a note and keeps it for this folder.
- `/pin`: lists the pins.
- `/unpin <n>` or `/unpin all`: removes pins. The rest are renumbered.

A pin lasts until you quit Claude Code. A kept pin is stored for the folder you started Claude Code in, and comes back the next time you start it there; a toast then says how many came back, so a forgotten one does not steer Claude unseen.

## Where they show

All pins share one row above the prompt, numbered for `/unpin`: `📌 1 use pnpm · 2 no force push`. A long row is cut at the edge; `/pin` lists them in full.

If that band is already busy, set **Where pins show** to `counter` in `/config`. Then only the number shows, at the right end of the line under the prompt: `📌 2 pins`.

## How Claude gets them

- When you pin or unpin, the command leaves Claude a note at once, so the change counts from your next message.
- The whole list is also part of the system prompt. Claude Code builds the system prompt again at the start of a session, after `/compact` and after `/clear`, so the pins are there each time without being sent with every message.

## Limits

- Between two rebuilds of the system prompt, it can still list a pin you removed. The unpin note tells Claude that the later change wins.
- Changing **Where pins show** reloads the mod, which drops pins that are not kept.
- Pins are plain instructions to the model, not rules the engine enforces. For a hard rule, use a hook such as guardrails.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install pin-board@claude-code-mods
```

Restart Claude Code.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh pin-board
```
