# compact-keeper

Saves a handoff file each time the conversation is compacted, so the context before `/compact` can be recovered.

## What it writes

One Markdown file per compaction in `~/.claude/handoffs/`, named `<date>-<time>-<project>-<session>.md`:

- when it ran, manual or automatic, and the token count before and after
- the working directory and the session id, with the `claude --resume` command
- any instructions given to `/compact`
- the files edited since the previous compaction
- the summary Claude Code wrote

A short toast names the file once it is saved. Subagent compactions are skipped, and a failed write never blocks the compaction.

## Limits

- Claude Code's built-in "Security default" plugin runs before the mod on Team and Enterprise plans, on a machine with managed settings, and in the desktop app unless you use a personal Pro or Max plan. The mod then sees a compaction only after it ran: `/compact` as soon as it ends, any other one at the end of its turn. That file has no token counts, and its trigger reads `auto or plugin` for anything but `/compact`.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install compact-keeper@claude-code-mods
```

Restart Claude Code. Nothing to open: the next compaction writes the first file.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh compact-keeper
```
