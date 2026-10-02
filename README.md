# claude-code-mods

Mods for [Claude Code](https://claude.com/claude-code): function-hook plugins that draw inside the terminal UI.

## Mods

| Mod | What it does |
| --- | --- |
| [session-meter](session-meter/README.md) | A docked pane with context usage, 5h/7d limits and pace, live tool calls and model requests; a one-time note to the model when limits or context run high |

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
