# session-meter

A docked pane that shows what is happening in a Claude Code session while you work.

![The session-meter pane with context, limits, tools and requests](../docs/session-meter.png)

## What it shows

- **Context**: what fills the context window by category, where auto-compact kicks in, the context size over turns, and the three heaviest items (memory files, MCP servers, skills listing).
- **Limits**: the 5-hour and 7-day usage windows, time to reset, and whether the current pace lasts until the reset.
- **Tools**: recent tool calls with their target and duration; running calls stay on top, subagent calls are marked `↳`.
- **Requests**: each model request with its loop (main or subagent type), input and output tokens, cache hit rate and duration. A low cache rate turns yellow or red.

## The note to the model

It also sends the model one hidden note when a threshold is crossed, and again only after the figure drops 10 points below it:

| Threshold | What the model is told |
| --- | --- |
| 5h window at 80% | Mention it in one line and keep going |
| 7d window at 80% and 90% | Warn clearly and ask before starting a large task |
| Context at 60% | When new work starts, suggest `/compact`, a fresh session, or a short handoff, whichever fits |

The note goes in as prompt context, not as a system prompt change, so the prompt cache is not invalidated. The pane lists every note it sent.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install session-meter@claude-code-mods
```

Restart Claude Code. The pane opens on its own in a terminal 144 columns or wider; otherwise type `/ctx`. It docks beside the transcript in fullscreen mode, from 110 columns.

## Notes

- Context percentages come from the same breakdown as `/context`, so they follow `CLAUDE_CODE_AUTO_COMPACT_WINDOW` if you set it.
- Usage limits show after the first model reply of a session; pace needs about 10 minutes of history in the current window.
- Everything stays local. The pane reads Claude Code's own session data and makes no network calls.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh session-meter
```
