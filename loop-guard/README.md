# loop-guard

Stops Claude from running the same failing call over and over.

![loop-guard's toast after a repeated failure](../docs/loop-guard.png)

## What it does

When a tool call fails twice with the same arguments and the same error, loop-guard adds a note to the second error. Only the model reads it; it tells the model not to try a third time, to re-read the error, and to change approach or ask you. A toast tells you the note went out.

- The call must match: same tool, same arguments, same agent. A tool's `description` is left out, since Claude words it anew on each try. A subagent's failures count apart from the main thread's.
- The error must match too. Running `npm test` again after a fix usually fails differently, so it is not flagged.
- The note and the toast go out once per call. After the call succeeds, a new pair of failures sends them again.
- A success of the same call clears its record. `/clear` and an interrupted turn (Esc) clear them all, since a call you stop fails the same way each time.

## Limits

- An error that carries a time or a random id differs each run, so it is never flagged.
- Refused calls are not counted, and they do not clear a failure.
- Only the last error of a call is kept: failing with A, then B, then A again sends no note.

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
