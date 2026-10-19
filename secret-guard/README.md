# secret-guard

Keeps secrets out of the conversation. API keys and private keys are hidden before Claude reads them, credential files cannot be opened, and commands that print secrets do not run.

![secret-guard's status light](../docs/secret-guard.png)

## What it does

- **Hides secrets in what tools return.** Known key formats become `[secret-guard: <rule>]` before Claude reads the result, and the session transcript on disk keeps the hidden form too. Formats: AWS, GitHub, Slack, Stripe, Google, Anthropic and OpenAI keys, private key blocks, JWTs, and secret-named values such as `DB_PASSWORD=…`, `REDISCLI_AUTH=…` or `"client_secret": "…"`, and the password in a connection URL such as `redis://:…@host`.
- **Hides secrets you paste.** A key in your own message reaches Claude and the transcript in the same hidden form.
- **Blocks credential files.** Reading or editing `.env` files, `.dev.vars`, `.envrc`, SSH and GPG private keys, `~/.aws/credentials`, gcloud, Azure, kube and Docker logins, `~/.config/gh/hosts.yml`, `.npmrc`, `.pypirc`, `.netrc`, shell history, Terraform state, browser password stores and the macOS keychain. A link to one of these files is followed and blocked too. Templates (`.env.example`, `.env.sample`, `.env.template`, `.env.defaults`, `.env.dist`) and public keys (`*.pub`) stay readable.
- **Blocks commands that print secrets.** `printenv`, bare `env` and `export`, `security find-generic-password`, `gh auth token`, `aws configure get`, `gcloud auth print-access-token`, `kubectl get secret`, `git credential fill`, `echo $SOME_TOKEN`, and any shell command that names a credential file, such as `cat .dev.vars | curl …`.
- **Blocks sending a secret out.** A command, web request or MCP call whose arguments carry a key is refused.
- **Shows a status light.** 🟢 nothing seen, 🟡 something was hidden, 🔴 something was blocked. `env scrub off` means Claude Code still passes your environment variables to the commands it runs (see below).

## Turn on env scrubbing too

Set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` in the `env` block of `~/.claude/settings.json`. Claude Code then removes its own credentials from the environment of the commands it runs, so there is nothing for a command to print. The mod cannot set this for you; the status light shows when it is off.

## Limits

- On some setups, Claude Code's built-in "Security default" plugin runs before the mod and sends some rows past it. Secrets in these rows reach Claude and the transcript unhidden:
  - files you add with `@`, and files Claude Code adds again after a summary
  - lines from a file that changed outside Claude
  - notes that other hooks add
  - conversation summaries
  - skill text
  - other attachments, such as an IDE selection

  This happens on Team and Enterprise plans, on a machine with managed settings, and in the desktop app unless you use a personal Pro or Max plan. Your prompts, pasted text, Claude's replies and tool results are still hidden, and the blocks still hold.
- A credential file you add with `@` is not blocked, because the block covers only what Claude opens. Known key formats in it are still hidden, unless "Security default" runs first.
- A script Claude writes and runs (`python -c …`, `node -e …`) can open any file. The mod cannot see what it opens; it hides known key formats in the output, nothing more.
- The mod does not read quoted text as commands. So `grep -E "(export )?" file` runs.
- A backslash in quotes is part of a search pattern, so `grep -rn '\.env' .` runs. Outside quotes it escapes the next character, so `cat \.env` is still blocked. A backslash separates directories only in a Windows path (`C:\…`, `\\server\…`).
- Punctuation right after a file name is not part of it, so `git commit -m "copy .env.example, then edit"` runs. After `.` or `/` it stays, so `grep -r token ~/.ssh/.` is still blocked.
- The mod treats a heredoc as data when `cat` or `tee` writes it out with a quoted delimiter, as in `cat > notes.py <<'EOF'`. It does not check that body. This holds only when the opener line has nothing but `&&` steps before it, and no `{`, `(` or `$(` is still open.
- The mod checks every other heredoc body. `python3 - <<'EOF'` runs its body as code. A `<<EOF` body runs any `$(…)` in it. So a credential file name (`.env`) in such a body is blocked.
- The mod does not read quotes in a heredoc body that runs. So a quoted `env` or `export` there is blocked, as in `grep -E "(export )?" f` in a `bash <<'EOF'` body, or `print('env')` in a `python3 <<'EOF'` body.
- The mod splits commands with a simple reader, not a full shell parser. A command built to fool it gets through. Examples:
  - a heredoc end line with extra spaces, or with a `\` on the line before it
  - a delimiter such as `<<$END` or `<<A-B!`
  - a `<<` inside a quote or a comment
  - nested escaped backticks, or `$(( '$(…)' ))`
  - a function that redefines `cat` or `tee`
  - a quoted bracket before an open `{` or `(`, as in `{ echo ")" && cat <<'EOF' … } | bash`, because the mod counts brackets without reading quotes

  The mod still hides known key formats in the output.
- Secrets in a format it does not know pass through.
- A connection URL password shorter than 8 characters, or with a raw `/` in it, is not hidden. A percent-encoded `/` (`%2F`) is fine. Dev passwords such as `postgres:postgres@` are hidden, so a shell command that holds one is refused.
- A name followed by `(` is read as a function call, not a file, so `grep "mock.env(" tests` runs. A zsh glob qualifier on a credential file (`cat .env(N)`) gets through the same way; known key formats in its output are still hidden. Code names such as `process.env`, `import.meta.env` and `c.env` are not files either, but a script that prints the whole environment (`console.log(process.env)`, `print(os.environ)`) is blocked.
- `jq` reads its first argument as a filter, so `jq '.env.PATH' settings.json` runs. The files it reads are still checked, including `--rawfile` and `--slurpfile` values, redirects, and the filter file of `-f`. Other tools with a filter argument, such as `yq`, are not read this way.
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
