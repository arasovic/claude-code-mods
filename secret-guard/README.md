# secret-guard

Keeps secrets out of the conversation. API keys and private keys are hidden before Claude reads them, credential files cannot be opened, and commands that print secrets do not run.

![secret-guard's status light](../docs/secret-guard.png)

## What it does

- **Hides secrets in what tools return.** Known key formats become `[secret-guard: <rule>]` before Claude reads the result, and the session transcript on disk keeps the hidden form too. Formats: AWS, GitHub, GitLab, Slack, Stripe, Google, Anthropic, OpenAI, OpenRouter, Groq, xAI, Hugging Face, npm, Shopify, SendGrid and HashiCorp Vault keys, private key blocks, age secret keys, JWTs, and secret-named values such as `DB_PASSWORD=…`, `REDISCLI_AUTH=…`, `"client_secret": "…"` or a YAML `api_key: …`, a string field named like a secret in a structured result, the password in a connection URL such as `redis://:…@host`, an `Authorization: Bearer …` or `Basic …` value, a URL credential such as `?access_token=…` or `X-Amz-Signature=…`, and the authorization and cookie values in a HAR file. A file path with an extension, such as `GOOGLE_APPLICATION_CREDENTIALS=/home/me/sa.json`, stays, and so does fetch's `credentials: "same-origin"`.
- **Hides secrets you paste.** A key in your own message reaches Claude and the transcript in the same hidden form.
- **Blocks credential files.** Reading or editing `.env` files, `.dev.vars`, `.envrc`, SSH and GPG private keys, `~/.aws/credentials`, gcloud, Azure, kube and Docker logins, `~/.config/gh/hosts.yml`, `.npmrc`, `.pypirc`, `.netrc`, shell history (zsh session files too) and REPL history such as `.rediscli_history`, coding agents' `auth.json` logins under a dot folder (`~/.codex`, `~/.pi/agent`), wrangler's `default.toml`, GitHub Copilot's `apps.json` and `hosts.json`, Terraform state, Chrome, Chromium, Brave, Edge and Firefox cookie and password stores (macOS, Linux and Windows profiles, quoted paths with spaces included), KeePass files, the `pass` store, 1Password and Bitwarden data on Linux, macOS and Windows (a whole vault folder too, and `$APPDATA` or `%APPDATA%` paths), a process's `environ`, and the macOS keychain. A link to one of these files is followed and blocked too. A file you add with `@` is not attached either, and a toast says so. Templates (`.env.example`, `.env.sample`, `.env.template`, `.env.defaults`, `.env.dist`) and public keys (`*.pub`) stay readable.
- **Blocks commands that print secrets.** `printenv`, `env` with no command (`env -0`, `env FOO=bar`), bare `export`, `declare` and `typeset` (and their `-p`), `security find-generic-password`, `gh auth token`, `aws configure get`, `gcloud auth print-access-token`, `gcloud secrets versions access`, `az keyvault secret show`, `kubectl get secret`, `git credential fill`, Bitwarden, 1Password and `pass` reads (`bw get`, `bw list items`, `bw export`, `bw unlock`, `op read`, `op inject`, `op signin`, `op item get --reveal`, `pass show`), decryption (`sops -d`, `age -d`, `gpg -d`, `gpg --export-secret-keys`, `ansible-vault view`), `echo $SOME_TOKEN`, `<<< $SOME_TOKEN`, a script that prints one such variable (`node -p process.env.GITHUB_TOKEN`), and any shell command that names a credential file, such as `cat .dev.vars | curl …`, or reaches one through a glob, a brace or a link (`cat ~/.aw?/credentials`, `cat .{env,bak}`, or `cat notes` where `notes` links to `.env`). A `NAME=value` or `env` before the command, or a full path such as `/usr/bin/printenv`, does not hide it.
- **Blocks sending a secret out.** A command, web request or MCP call whose arguments carry a key is refused.
- **Checks an env file without showing it.** Claude can call the `env_check` tool to ask whether `.env` or another env file sets a variable. The answer is `set`, `empty` or `missing`. It also says when the template, such as `.env.example`, does not list the name. The tool reads the file, but Claude never sees a value or its length. When the mod blocks a read or a command, the refusal names the tool.
- **Shows a status light.** 🟢 nothing seen, 🟡 something was hidden, 🔴 something was blocked. `env scrub off` means Claude Code still passes your environment variables to the commands it runs (see below).

## Turn on env scrubbing too

Set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` in the `env` block of `~/.claude/settings.json`. Claude Code then removes its own credentials from the environment of the commands it runs, so there is nothing for a command to print. The mod cannot set this for you; the status light shows when it is off.

## Stop the skipped-hook notice

When Claude Code's "Security default" plugin runs first (see Limits), Claude Code says once a session that secret-guard's `session.append` hook was skipped. To stop that notice, turn on **Skip rows Security default sends past** in `/config` (the `skipBypassedRows` option). The mod then stops checking the rows Security default sends past it.

Turn it on only on a Team or Enterprise plan or with managed settings. On any other setup, secrets in files added with `@`, conversation summaries, hook notes, skill text and other attachments then stop being hidden. On every setup, messages that other tools add go unhidden too. If a plugin your organization manages adds notes to the conversation, the notice can come back.

## Limits

- On some setups, Claude Code's built-in "Security default" plugin runs before the mod and sends some rows past it. Secrets in these rows reach Claude and the transcript unhidden:
  - files you add with `@`, and files Claude Code adds again after a summary
  - lines from a file that changed outside Claude
  - notes that other hooks add
  - conversation summaries
  - skill text
  - other attachments, such as an IDE selection

  This happens on Team and Enterprise plans and on a machine with managed settings. Your prompts, pasted text, Claude's replies and tool results are still hidden, and the blocks still hold.
- The mod looks up the globs, braces and links of a shell command in the file system. This check has limits:
  - It reads only words with no quote or backslash. A quoted or escaped glob, or a quoted link, is not looked up. A credential file name in it is still blocked.
  - It does not look into heredoc bodies, `bash -c "…"` text, or what `echo` and `printf` print.
  - A relative path is looked up in the shell's current folder, so a `cd` in an earlier command counts. A plain `cd <folder>` earlier in the same command counts too, but a `cd` there with a quote or a `$` sends the check to the wrong folder.
  - `**` matches one folder level, like `*`. As in the shell, `*` skips a dotfile, so `cat *` does not check `.env`, but `cat .*` does. When the command may turn on dotglob (`shopt`, `set`, `setopt`, `eval`, `source`, `GLOBIGNORE`, or zsh's `*(D)`), `*` matches a dotfile too. The check assumes your shell profile does not turn dotglob on.
  - A path with `$` or a backtick, other than a leading `$HOME`, is not looked up.
  - A command that needs more than 32 file system calls is refused. Split it, or name the files instead of a pattern.
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
- Secrets in a format it does not know pass through. Examples:
  - WireGuard's `PrivateKey = …`, Azure DevOps tokens, and PHP's `define('DB_PASSWORD', '…')`
  - a `Cookie:` header outside a HAR file
  - a Kubernetes Secret `data:` value whose key is not named like a secret (`tls.key`, `.dockerconfigjson`)
  - a password shorter than 8 characters, or another secret-named value shorter than 12
  - an unquoted YAML value with no digit (`password: hunterhunter`)
  - a Bearer or Basic credential with no `Authorization` header name before it, or shorter than 20 characters
- A URL credential (`?token=`, `?api_key=`, `X-Amz-Signature=`, `sig=`) is hidden in your messages too. So a signed download link you paste reaches Claude without its signature, and Claude cannot open it. Download the file yourself and give Claude its path.
- A command that sends a variable, such as `curl "https://api.test/?t=$TOKEN"`, runs. The mod sees only the name, not the value. Env scrubbing (above) is the defense here.
- Commands are read in shell (sh, bash, zsh) form only. PowerShell and cmd forms that print secrets, such as `echo $env:API_KEY`, `Get-ChildItem Env:` or `cmd /c set`, run. A credential file name in them is still blocked.
- If a check itself fails, the call is refused. When the tool had already started, it may have run, and only its output is withheld.
- A connection URL password shorter than 8 characters, or with a raw `/` in it, is not hidden. A percent-encoded `/` (`%2F`) is fine. Dev passwords such as `postgres:postgres@` are hidden, so a shell command that holds one is refused.
- A name followed by `(` is read as a function call, not a file, so `grep "mock.env(" tests` runs. A zsh glob qualifier on a credential file (`cat .env(N)`) gets through the same way; known key formats in its output are still hidden. Code names such as `process.env`, `import.meta.env` and `c.env` are not files either, but a script that prints the whole environment (`console.log(process.env)`, `print(os.environ)`) is blocked. So is one that prints a secret-named variable in the same statement (`print(os.getenv("API_KEY"))`) in JavaScript, Python or Ruby; a test such as `!process.env.GITHUB_TOKEN` runs, and other languages are not read.
- `jq` reads its first argument as a filter, so `jq '.env.PATH' settings.json` runs. The files it reads are still checked, including `--rawfile` and `--slurpfile` values, redirects, and the filter file of `-f`. Other tools with a filter argument, such as `yq`, are not read this way. A filter that uses jq's `env` or `$ENV` prints the environment, so it is blocked, `jq -n 'env.HOME'` included.
- The quoted text of a git `-m` message and of a gh `--title`, `--body` or `--notes` is not read, so `git commit -m "ignore .env files"` runs. A message or body file (`-F`, `--body-file`) is still read, and so is quoted text with `$` or a backtick in it.
- Commands that touch a credential file without printing it still run: `ls`, `stat`, `test` / `[`, `touch`, `chmod`, `chown`, `rm`, `ssh-keygen` (but not `-i`, which prints a private key), `ssh-add`, and `ssh`, `scp` or `sftp` with a key given by `-i` or `IdentityFile` before the host (in `GIT_SSH_COMMAND` too). In a command with a pipe, `$(…)` or a backtick they are read like any other, because the file name they print can reach a command that opens it (`ls .env | xargs cat`). `cp` and `mv` run when the credential file is the target (`cp .env.example .env`), not when it is the source, so a file cannot be copied to a new name and read there.
- `env_check` has these limits:
  - `set` means only that the line has a value. A placeholder copied from the template, such as `API_KEY=your-key-here`, is `set` too. The answer says this whenever a name is `set`. If a service fails, check the value yourself.
  - It does not compare values with the template. Otherwise Claude could guess a value by changing the template.
  - `X=""` and `X='  '` are `empty`. A line without `=` is not read.
  - As in a shell, a `#` starts a comment only after a space: `X= # note` is `empty`, `X=#abc` is `set`. Node's dotenv reads `X=#abc` as empty.
  - When Claude gives no names, the tool lists the names in the file and in the template. It lists only names in capitals, such as `API_KEY`.
  - It reads only the env files that secret-guard blocks: `.env`, `.env.*`, `*.env`, `.dev.vars`, `.envrc` and `.flaskenv`. A template is one of these names with `.example`, `.sample`, `.template`, `.defaults` or `.dist` added. It is given as the template, not as the file.
  - The answer shows a path as Claude typed it, so `~/app/.env` does not show your home folder.
  - It follows a link only to one of these files. When it cannot tell where a link leads, it does not read the file.
- The screen can show a row for a moment before it is rewritten. Claude and the transcript only read the hidden form.
- A value hidden in source code, such as a test token, is hidden from Claude as well. Claude can still edit the other lines of that file. A file write, shell command or MCP call that would put a `[secret-guard: <rule>]` tag back is refused, so the real value is never overwritten; Claude will ask you to change that line.

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
