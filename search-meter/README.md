# search-meter

Counts the searches Claude runs and colors each one, so you can see how many searches went to waste.

![search-meter's status line](../docs/search-meter.png)

## What it shows

A line under the prompt, from the first search on: `🔍 🟢 8 🟡 2 🔴 3 · last 🟢🟡🟢🟢🔴`.

- 🟢 found something on the first try.
- 🟡 found something after one or more searches that found nothing.
- 🔴 found nothing.
- `last` shows the five most recent searches, oldest first.

The counts cover the whole session, subagents included, and start over on `/clear`.

## What counts as a search

- A shell command with a step that starts with `grep`, `egrep`, `fgrep`, `rg`, `ag`, `ack`, `find`, `fd` or `git grep`. It found nothing when it printed nothing or failed.
- A web search. It found nothing when it returned no links.
- A tool search (`ToolSearch`). It found nothing when it matched no tool.

## Limits

- Searches are not grouped by what they look for: a find right after an unrelated miss counts as 🟡. Subagent searches run between the main thread's searches.
- Output decides, not meaning: `grep -c` printing `0` counts as found, and `grep -q` counts as found nothing. A command that also prints something else (`ls && grep x`) counts as found.
- Searches that were refused, interrupted or sent to the background are not counted.
- Builds that have separate `Grep` and `Glob` tools are not counted yet; 2.1.288 searches through the shell.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install search-meter@claude-code-mods
```

Restart Claude Code. The line appears under the prompt after the first search.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh search-meter
```
