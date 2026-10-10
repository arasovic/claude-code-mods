# guardrails

Blocks shell commands you choose never to let Claude run. Claude gets the reason back and can retry the right way.

Every rule starts off. After you install, the plugin blocks nothing until you turn a rule on in `/config`.

## Rules

| `/config` option | Blocks | Claude is told |
| --- | --- | --- |
| `cfWrites` | `cf deploy`, `cf migrate`, `cf init` | Ask the user to run them. |
| `attribution` | `git commit`, `gh pr`, `gh issue` with a `Co-Authored-By` or "Generated with Claude" line | Remove the line and retry. |
| `claudeBranches` | `git checkout -b`, `git switch -c`, `git branch`, `git push` naming a `claude/` branch | Use a purpose prefix such as `fix/` or `chore/`. |

Turn a rule on in `/config`, or in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "guardrails@claude-code-mods": {
    "options": { "cfWrites": true, "attribution": true, "claudeBranches": true }
  }
}
```

The `attribution` rule is a backstop. To stop Claude Code from adding attribution in the first place, set Claude Code's own top-level `"attribution": false` in `settings.json`.

Reading credential files is [secret-guard](../secret-guard/README.md)'s job.

## Your own rules

To block another command, use a permission deny rule in `settings.json`. It needs no plugin:

```json
"permissions": { "deny": ["Bash(npm publish:*)"] }
```

## Limits

- It reads the command text only. `git commit -F file`, shell aliases and scripts get through. Use permission deny rules where you need a hard guarantee.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install guardrails@claude-code-mods
```

Restart Claude Code, then turn on the rules you want in `/config`.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh guardrails
```
