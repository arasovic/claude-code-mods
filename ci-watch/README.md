# ci-watch

See GitHub Actions finish without leaving Claude Code. After Claude pushes a branch, opens a PR or pushes a tag, a band above the prompt shows each workflow run with a progress bar, then a toast says whether it passed.

<img src="../docs/ci-watch.png" alt="A CI run with its progress bar, then the passed result" width="556">

## What it shows

- `⟳ push main · CI ████████░░░░░░░░░░░░ 1m10s / ~2m45s`: one row per running workflow. The bar compares the time so far with the workflow's last successful run, and stays short of full until the run ends.
- `✓ push main: CI passed` or `✗ push main: CI failure`: the result, in green or red, also as a toast. It stays until you send your next message.
- `push docs: no workflow triggered`: no run started within 90 seconds.

A push and the PR opened on that branch share one row, and it waits for both sets of runs. A push to a branch with an open PR also waits for its `pull_request` runs. A tag push waits for the runs on that tag, not the branch CI that already ran on the same commit.

Only the repo Claude Code was started in is watched. A push from `cd <other repo> && git push` or `git -C <other repo>` is left alone.

## Failed scheduled workflows

Turn on **Flag failed scheduled workflows** in `/config` to check scheduled runs at start. Each workflow whose latest scheduled run in the last 14 days failed gets a red row with its link. **Dismiss** hides those runs for this repo; a later failure shows again.

This is off by default, because it makes a few `gh` calls at every start.

## Limits

- It needs [`gh`](https://cli.github.com), logged in to the repo's GitHub account.
- It polls every 10 seconds and gives up after 60 minutes.
- It reads the commit from `origin`. A push to another remote falls back to the local branch.
- It sees pushes made through Claude's Bash tool. A push from another terminal is not seen.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install ci-watch@claude-code-mods
```

Restart Claude Code.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh ci-watch
```
