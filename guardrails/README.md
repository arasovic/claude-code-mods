# guardrails

Blocks three kinds of shell commands: Cloudflare writes, attribution lines in commits and PRs, and `claude/` branch names. Claude gets the reason back and can retry the right way.

## What it blocks

| Command | Why |
| --- | --- |
| `cf deploy`, `cf migrate`, `cf init` | Cloudflare writes stay on each project's Wrangler flow. |
| `git commit`, `gh pr`, `gh issue` with a `Co-Authored-By` or "Generated with Claude" line | No tool attribution in commits, pull requests or issues. |
| `git checkout -b`, `git switch -c`, `git branch`, `git push` naming a `claude/` branch | Branches use a purpose prefix such as `fix/` or `chore/`. |

Reading credential files is [secret-guard](../secret-guard/README.md)'s job.

## Limits

- It reads the command text only. `git commit -F file`, shell aliases and scripts get through. Use permission deny rules in `settings.json` where you need a hard guarantee.
- The rules are fixed in the code. Edit `hooks/register.ts` to change them.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install guardrails@claude-code-mods
```

Restart Claude Code.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh guardrails
```
