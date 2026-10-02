# secret-guard

Keeps secrets out of the conversation. API keys and private keys are hidden before Claude reads them, credential files cannot be opened, and commands that print secrets do not run.

![secret-guard's status light](../docs/secret-guard.png)

## What it does

- **Hides secrets in what tools return.** Known key formats become `[secret-guard: <rule>]` before Claude reads the result, and the session transcript on disk keeps the hidden form too. Formats: AWS, GitHub, Slack, Stripe, Google, Anthropic and OpenAI keys, private key blocks, JWTs, and secret-named values such as `DB_PASSWORD=…` or `"client_secret": "…"`.
- **Hides secrets you paste.** A key in your own message reaches Claude and the transcript in the same hidden form.
- **Blocks credential files.** Reading or editing `.env` files, `.dev.vars`, `.envrc`, SSH and GPG private keys, `~/.aws/credentials`, gcloud, Azure, kube and Docker logins, `~/.config/gh/hosts.yml`, `.npmrc`, `.pypirc`, `.netrc`, shell history, Terraform state, browser password stores and the macOS keychain. A link to one of these files is followed and blocked too. Templates (`.env.example`, `.env.sample`, `.env.template`) and public keys (`*.pub`) stay readable.
- **Blocks commands that print secrets.** `printenv`, bare `env` and `export`, `security find-generic-password`, `gh auth token`, `aws configure get`, `gcloud auth print-access-token`, `kubectl get secret`, `git credential fill`, `echo $SOME_TOKEN`, and any shell command that names a credential file, such as `cat .dev.vars | curl …`.
- **Blocks sending a secret out.** A command, web request or MCP call whose arguments carry a key is refused.
- **Shows a status light.** 🟢 nothing seen, 🟡 something was hidden, 🔴 something was blocked. `env scrub off` means Claude Code still passes your environment variables to the commands it runs (see below).

## Turn on env scrubbing too

Set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` in the `env` block of `~/.claude/settings.json`. Claude Code then removes its own credentials from the environment of the commands it runs, so there is nothing for a command to print. The mod cannot set this for you; the status light shows when it is off.

## Limits

- A script Claude writes and runs (`python -c …`, `node -e …`) can open any file. The mod cannot see what it opens; it hides known key formats in the output, nothing more.
- Secrets in a format it does not know pass through.
- A name followed by `(` is read as a function call, not a file, so `grep "mock.env(" tests` runs. A zsh glob qualifier on a credential file (`cat .env(N)`) gets through the same way; known key formats in its output are still hidden. Code names such as `process.env`, `import.meta.env` and `c.env` are not files either, but a script that prints the whole environment (`console.log(process.env)`, `print(os.environ)`) is blocked.
- Commands that touch a credential file without printing it still run: `ls`, `stat`, `test` / `[`, `touch`, `chmod`, `chown`, `rm`. `cp` and `mv` run when the credential file is the target (`cp .env.example .env`), not when it is the source, so a file cannot be copied to a new name and read there.
- The screen can show a row for a moment before it is rewritten. Claude and the transcript only read the hidden form.
- A value hidden in source code, such as a test token, is hidden from Claude as well. Claude can still edit the other lines of that file. A write that would put a `[secret-guard: <rule>]` tag back into a file is refused, so the real value is never overwritten; Claude will ask you to change that line.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install secret-guard@claude-code-mods
```

Restart Claude Code. The status light appears under the prompt.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh secret-guard
```
