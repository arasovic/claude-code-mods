# review-ping

Reminds Claude to review a big commit before it calls the work done.

## What it does

When Claude commits 30 or more changed lines and no review ran since the commit before it, review-ping adds a note to the commit's result. Only the model reads it. It tells the model to review the commit: with a code review skill or reviewer agent if one is installed, such as `code-review`, or else by reading `git show <hash>` itself. A toast tells you the note went out.

```text
review-ping: commit 1a2b3c4 changed 35 lines with no review; Claude was asked to review it
```

- The line count comes from git's own summary under `git commit`: insertions plus deletions.
- A review is a skill or an agent type whose name holds "review", run by Claude, or a slash command such as `/code-review` that you type.
- A review covers the next commit. Each commit clears it, so the commit after that needs a review of its own.
- A review between a note and the next commit is the review of the noted commit. It does not cover the commit after it.
- `/clear` forgets a review.

## Limits

- Every file counts, docs and lock files too.
- `git commit -q` prints no summary, so it gets no note.
- A review counts for the next commit even when more edits came after it.
- A reviewer agent counts when Claude starts it, not when it finishes.
- Commits a subagent makes get no note. The main thread reviews its work.
- Only commits Claude makes with its Bash tool are seen, not commits you make in your own terminal.
- Small commits never add up: three commits of 20 lines get no note.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install review-ping@claude-code-mods
```

Restart Claude Code.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh review-ping
```
