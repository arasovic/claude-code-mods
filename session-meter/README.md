# session-meter

A docked pane that shows what is happening in a Claude Code session while you work.

![The session-meter pane with context, limits, tools and requests](../docs/session-meter.png)

## What it shows

- **Context**: what fills the context window by category, where auto-compact kicks in, the context size over turns, and the three heaviest items (memory files, MCP servers, the skills listing, slash commands, agents).
- **Limits**: the 5-hour and 7-day usage windows, time to reset, and whether the current pace lasts until the reset.
- **Tools**: recent tool calls with their target and duration; running calls stay on top, subagent calls are marked `↳`.
- **Requests**: each model request with its loop (main or subagent type), input and output tokens, cache hit rate and duration. A low cache rate turns yellow or red.

## The note to the model

It also sends the model one hidden note when a threshold is crossed, and again only after the figure drops 10 points below it:

| Threshold | What the model is told |
| --- | --- |
| 5h window at 80% | Mention it in one line and keep going |
| 7d window at 80% and 90% | Warn clearly and ask before starting a large task |
| Context at `contextAt` (60%) | When new work starts, suggest `/compact`, a fresh session, or a short handoff, whichever fits |

The note goes in as prompt context, not as a system prompt change, so the prompt cache is not invalidated. The pane lists the last five notes it sent.

## Letting the model reset the context

By default the model only suggests a reset and you decide. Two options in `/config` change that:

| Option | Values | What it does |
| --- | --- | --- |
| `contextAction` | `suggest` (default) | The model suggests `/compact` or a fresh session. |
| | `compact` | The model gets a `context_reset` tool. At a natural break it calls the tool. When the turn ends, the mod compacts the conversation and sends the model its next step, so the work goes on. |
| | `compact-or-clear` | As `compact`. The model can also choose a clear when the next work does not build on the conversation. A clear needs a handoff of at least 200 characters. The mod saves the handoff to `~/.claude/handoffs/`, runs `/clear`, then sends the handoff as the first message of the new session. |
| `contextAt` | 10 to 95, default 60 | The context percentage that sends the note. |

The tool refuses a call below `contextAt` and a call from a subagent. When you interrupt the turn, no reset runs. The old conversation stays available with `/resume`.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install session-meter@claude-code-mods
```

Restart Claude Code. The pane opens on its own in a terminal 144 columns or wider; otherwise type `/ctx`. It docks beside the transcript in fullscreen mode, from 110 columns.

To keep the screen clear, turn off **Open the pane at start** in `/config` (the `autoOpen` option). `/ctx` still opens the pane, and the notes to the model still go out.

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
