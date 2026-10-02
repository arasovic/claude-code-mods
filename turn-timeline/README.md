# turn-timeline

A pane that draws the current turn as a timeline, one lane per loop.

<img src="../docs/turn-timeline.png" alt="The turn-timeline pane with a timeline, time breakdown and slowest steps" width="520">

## What it shows

- **Glance row**: how long the turn has run, and the share spent in model requests, tools and idle.
- **Timeline**: a lane for the main loop and one per subagent. Green blocks are tool calls, red ones failed, shaded blocks are model requests, dots are idle time. Background subagents keep drawing after the main loop ends.
- **Where time went**: the main loop's time split between model, each tool and idle.
- **Slowest**: the three longest steps of the turn, with their target or request number.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install turn-timeline@claude-code-mods
```

Restart Claude Code and type `/timeline`. It follows the running turn and keeps the last one after it ends.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh turn-timeline
```
