# change-ledger

A pane that lists every file the session changed, next to the git working tree.

<img src="../docs/change-ledger.png" alt="The change-ledger pane listing edited files with line counts" width="520">

## What it shows

- **Glance row**: files changed, lines added and removed, and the branch with commits ahead and behind.
- **Edits**: each file Claude edited or wrote, newest first, with a bar of lines added and removed, a `new` tag for created files, its folder, which agents touched it, how many edits, and how long ago.
- **Working tree**: `git status` for the repo, with files Claude edited marked `●` and other changes `○`, so edits made outside the session stand out.

Line counts for edits come from the edit itself; the working tree counts come from `git diff --numstat HEAD`, refreshed after each turn.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install change-ledger@claude-code-mods
```

Restart Claude Code and type `/changes`. Panes open as tabs, so it sits beside other mod panes.

## Notes

- Only the Edit and Write tools are tracked. Files changed by shell commands show in the working tree, not in Edits.
- The working tree needs the session to start inside a git repository.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh change-ledger
```
