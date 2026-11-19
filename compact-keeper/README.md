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

## Stop the skipped-hook notice

When Security default runs first (see Limits), Claude Code says once a session that compact-keeper's `session.compact` hook was skipped. To stop that notice, turn on **Skip the compaction hook** in `/config` (the `skipCompactHook` option). The mod then stops hooking the compaction itself and saves each compaction after it, as described under Limits.

On other setups, leave it off. With it on, every file then has the limits listed below: no token counts, a less exact trigger, a later save, and the cases that get no file.

## Fallback summary

Off by default. Some gateways that relay requests through another Claude Code run make a compaction, `/compact` or automatic, fail with `summarization produced empty response`: the run takes the summary request for part of the conversation and carries on the chat. With **Write a fallback summary** on in `/config` (the `summaryFallback` option), the mod then asks the session's model for the summary itself, with the request in the system prompt and the transcript as data, and compacts with that. A toast says when it did.

- It is one more model request, billed like the first, each time a compaction fails that way.
- It only answers that one error, on the main conversation. If the fallback is empty too, the original error stands.
- The compacted conversation holds the summary alone, without the messages Claude Code keeps after its own compaction.
- It cannot run where Security default runs first or with **Skip the compaction hook** on: the mod does not see the compaction there.

## Limits

- Claude Code's built-in "Security default" plugin runs before the mod on Team and Enterprise plans and on a machine with managed settings. The mod then notices a compaction only after it: `/compact` is saved about a second after it finishes, an automatic compaction at the end of the reply it ran in, and one while the session is idle at the end of the next reply. That file has no token counts, and its trigger reads `auto or plugin` for anything but `/compact`. Two compactions in one reply get one file, with the later summary. In the desktop app, `/clear` stops Claude Code before the mod can read the conversation, so an automatic compaction not saved yet gets no file.

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
