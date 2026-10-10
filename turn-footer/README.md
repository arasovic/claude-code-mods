# turn-footer

Adds a summary line under each answer and names the running tool in the spinner.

<img src="../docs/turn-footer.png" alt="A turn summary line under the Worked for line" width="420">

## What it shows

- **Under each answer**, below Claude Code's own "Worked for …" line: tool calls and failures, subagents, model requests, input and output tokens, and the cache hit rate. A low cache rate turns yellow under 50% and red under 20%.
- **In the spinner**, while a tool runs: its name and how long it has been running.

Subagent work counts toward the turn that started it.

The summary line shows in the terminal only. The Claude desktop app does not draw the "Worked for …" line, so the summary has no place to go there.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install turn-footer@claude-code-mods
```

Restart Claude Code. The summary shows from the next answer on.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh turn-footer
```
