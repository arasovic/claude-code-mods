# claude-code-mods

Mods for [Claude Code](https://claude.com/claude-code): function-hook plugins that draw inside the terminal UI.

## Mods

| Mod | What it does |
| --- | --- |
| [session-meter](session-meter/README.md) | A docked pane with context usage, 5h/7d limits and pace, live tool calls and model requests; a one-time note to the model when limits or context run high |
| [turn-footer](turn-footer/README.md) | A summary line under each answer (tools, requests, tokens, cache hit) and the running tool with its clock in the spinner |
| [change-ledger](change-ledger/README.md) | A pane listing the files this session edited, with line counts and which agent edited them, beside the git working tree |
| [turn-timeline](turn-timeline/README.md) | A pane drawing the current turn as a timeline of model requests and tool calls per loop, with where the time went |
| [compact-keeper](compact-keeper/README.md) | Saves each compaction's summary, session id and edited files to `~/.claude/handoffs`, so nothing before `/compact` is lost |

## Install

Add this repo as a plugin marketplace once, then install any mod from it:

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install <mod>@claude-code-mods
```

Restart Claude Code after installing. Update later with `claude plugin marketplace update claude-code-mods` and `claude plugin update <mod>@claude-code-mods`.

Tested on Claude Code 2.1.287. Mods are a recent Claude Code feature, so older versions will not load them.

## License

MIT
