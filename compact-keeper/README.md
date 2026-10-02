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

`typecheck.sh` lays the plugin API's types in `.claude-plugin/types/` when they are missing or from another Claude Code build, then runs `tsc`.
