# claude-code-mods

![claude-code-mods: mods that draw inside Claude Code](docs/banner.png)

Mods for [Claude Code](https://claude.com/claude-code): function-hook plugins that draw inside the terminal UI.

## Mods

| Mod | What it does |
| --- | --- |
| [session‑meter](session-meter/README.md) | A docked pane with context usage, 5h/7d limits and pace, live tool calls and model requests; a one-time note to the model when limits or context run high |
| [turn‑footer](turn-footer/README.md) | A summary line under each answer (tools, requests, tokens, cache hit) and the running tool with its clock in the spinner |
| [change‑ledger](change-ledger/README.md) | A pane listing the files this session edited, with line counts and which agent edited them, beside the git working tree |
| [turn‑timeline](turn-timeline/README.md) | A pane drawing the current turn as a timeline of model requests and tool calls per loop, with where the time went |
| [compact‑keeper](compact-keeper/README.md) | Saves each compaction's summary, session id and edited files to `~/.claude/handoffs`, so nothing before `/compact` is lost |
| [show‑me](show-me/README.md) | A pane drawing the mermaid diagrams of each answer as images; `/show-me <question>` asks for an answer in diagrams |
| [secret‑guard](secret-guard/README.md) | Hides API keys and private keys before the model or the transcript sees them, blocks reads of credential files and commands that print secrets, and shows a status light |
| [cache‑timer](cache-timer/README.md) | A countdown above the prompt to when the prompt cache expires, and how many tokens the next message re-caches once it has |

## Install

Add this repo as a plugin marketplace once, then install any mod from it:

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install <mod>@claude-code-mods
```

Restart Claude Code after installing. Update later with `claude plugin marketplace update claude-code-mods` and `claude plugin update <mod>@claude-code-mods`.

Tested on Claude Code 2.1.288. Mods are a recent Claude Code feature, so older versions will not load them.

## Develop

Each mod's README lists its checks. `typecheck.sh` lays the plugin API's types in `.claude-plugin/types/` when they are missing or from another Claude Code build, then runs `tsc`. Run it with no argument to check every mod.

## License

MIT
