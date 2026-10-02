# loop-guard

Stops Claude from running the same failing call over and over.

## What it does

When a tool call fails twice with the same arguments and the same error, loop-guard adds a note to the second error. Only the model reads it; it tells the model not to try a third time, to re-read the error, and to change approach or ask you.

- The call must match: same tool, same arguments, same agent. A tool's `description` is left out, since Claude words it anew on each try. A subagent's failures count apart from the main thread's.
- The error must match too. Running `npm test` again after a fix usually fails differently, so it is not flagged.
- A success of the same call clears its record, and `/clear` clears them all.
- Every further identical failure carries the note again.

## Limits

- An error that carries a time or a random id differs each run, so it is never flagged.
- A call you interrupt twice counts as the same error.
- Refused calls are not counted.
- Nothing shows on your screen; the note is in the transcript only as model context.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install loop-guard@claude-code-mods
```

Restart Claude Code.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh loop-guard
```
