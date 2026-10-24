import type { EngineInterface, Register } from 'claude-code'
import { commandSegments, jqReadsEnvironment, pathWords, quotedWords, withoutDataHeredocs, withoutJqFilter } from './shell-read'

// Derived from gitleaks' default rules, loosened where key formats change.
const SECRET_RULES: readonly [string, RegExp][] = [
  ['private-key', /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----|$)/g],
  ['aws-key', /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g],
  ['github-token', /\b(?:gh[pousr]_[0-9A-Za-z]{36}|github_pat_\w{82})\b/g],
  ['slack-token', /\bxox[abpers]-[0-9A-Za-z-]{10,}/g],
  ['slack-webhook', /hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+/]{43,56}/g],
  ['stripe-key', /\b[sr]k_(?:test|live|prod)_[0-9A-Za-z]{10,99}\b/g],
  ['google-api-key', /\bAIza[\w-]{35}(?![\w-])/g],
  ['anthropic-key', /\bsk-ant-[\w-]{20,}/g],
  ['openai-key', /\bsk-(?:proj|svcacct|admin)-[\w-]{20,}/g],
  ['jwt', /\bey[A-Za-z0-9_-]{17,}\.ey[A-Za-z0-9_-]{17,}\.[A-Za-z0-9_-]{10,}/g],
]

// Only the value is hidden; the name stays so the model knows the key exists.
const ASSIGNMENTS = [
  // .env style: UPPER_CASE name, unquoted or quoted value, not a $reference or <placeholder>
  // AUTH and PASS count only as the last whole word (REDISCLI_AUTH, DB_PASS), so AUTHOR, BYPASS and GOOGLE_OAUTH stay.
  /^(?<head>\s*(?:export\s+)?(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*|(?:[A-Z0-9_]*_)?(?:AUTH|PASS))\s*=\s*["']?)(?<value>[^\s"'#$<]{12,})/gm,
  // code, JSON, YAML: a quoted literal assigned to a secret-shaped name
  /(?<head>["']?\b[\w.-]*(?:secret|token|password|passwd|api_?key|access_?key|private_?key)["']?\s*[:=]\s*(["']))(?<value>[^"'\s$<{]{12,})(?=\2)/gi,
  // the password in a connection URL: redis://:pass@host, postgres://user:pass@host; it runs to the last @
  /(?<head>\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)(?<value>[^\s/$<{[][^\s/]{7,})(?=@)/gi,
]

const tag = (rule: string) => `[secret-guard: ${rule}]`
const isExample = (match: string) => /example|dummy|placeholder/i.test(match)

export const scrub = (text: string): { text: string; rules: string[] } => {
  const rules: string[] = []
  let out = text
  for (const [rule, pattern] of SECRET_RULES) {
    out = out.replace(pattern, match => {
      // A cut-off private key runs to the end of the text, so the example check would read unrelated words.
      if (rule !== 'private-key' && isExample(match)) return match
      rules.push(rule)
      return tag(rule)
    })
  }
  for (const pattern of ASSIGNMENTS) {
    out = out.replace(pattern, (match, ...args) => {
      const { head, value } = args.at(-1) as { head: string; value: string }
      if (isExample(value) || value.startsWith('[secret-guard')) return match
      rules.push('secret-value')
      return head + tag('secret-value')
    })
  }
  return { text: out, rules }
}

// Rewrites every string inside a value, keeping its shape.
export const scrubDeep = <T>(value: T, found: string[]): T => {
  if (typeof value === 'string') {
    const s = scrub(value)
    found.push(...s.rules)
    return s.text as T
  }
  if (Array.isArray(value)) return value.map(v => scrubDeep(v, found)) as T
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, found)])) as T
  return value
}

// Browser profiles and password-manager data, whose paths can hold spaces (`Application Support`, `User Data`, `Login Data`,
// `Group Containers`). Local State holds the key that decrypts Chromium's cookies and passwords.
const SPACED_PATHS: readonly RegExp[] = [
  /\/library\/(application support|cookies)\/.*\/(login data|cookies|cookies\.sqlite|key4\.db|logins\.json)$/,
  /\/(google-chrome[^/]*|chromium|chrome|brave-browser|bravesoftware|microsoft-edge[^/]*|edge|firefox|mozilla)\/.*\/(login data[^/]*|(extension )?cookies(-journal)?|web data(-journal)?|local state|vpn tokens(-journal)?|cookies\.sqlite(-shm|-wal)?|key4\.db|logins(-backup)?\.(json|db)|formhistory\.sqlite)$/,
  /\/(library\/application support|appdata\/roaming)\/bitwarden(\/|$)/, /\/appdata\/local\/1password\/data(\/|$)/,
  /\/library\/group containers\/2bua8c4s2c\.com\.(1password|agilebits)(\/|$)/,
]

// Matched against the lowercased path with forward slashes and a leading slash.
const SENSITIVE_PATHS: readonly RegExp[] = [
  // `name.env` files, but not the code spellings a search names (`grep -rn process.env src`).
  /\/\.env$/, /\/\.env\.(?!(example|sample|template|defaults|dist)$)[^/]+$/, /\/(?!(process|import\.meta|c)\.env$)[^/\\]+\.env$/,
  /\/\.envrc$/, /\/\.dev\.vars(\.[^/]+)?$/, /\/\.flaskenv$/,
  /\/\.(aws|gem|cargo|config\/git)\/credentials(\.toml)?$/, /\/credentials\.json$/, /\/service-account[^/]*\.json$/, /\/\.vault-token$/, /\/\.vault_pass$/,
  // A bare `e.key` or `event.key` in a command is code reading a field (`store.get(e.key)`), not a key file; a path to one still counts.
  /^(?!\/([a-z]|this|self|event|evt|entry|item|node|props|row|pair|kv|obj)\.key$).*\.(key|p12|pfx|jks|keystore|ppk)$/,
  /\/id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/,
  /\/\.ssh\/(?!(known_hosts[^/]*|config|authorized_keys|[^/]+\.pub)$)[^/]+$/,
  /\/\.(npmrc|pypirc|netrc|git-credentials|pgpass|my\.cnf|s3cfg)$/, /\/_netrc$/,
  /\/\.(bash|zsh|sh|python|node_repl|psql|mysql|sqlite)_history$/, /\/\.zhistory$/, /\/fish_history$/,
  /\/\.aws\/(sso|cli)\/cache\//, /\/\.config\/gcloud\/(credentials\.db|access_tokens\.db|application_default_credentials\.json|legacy_credentials\/)/,
  /\/\.azure\/(accesstokens\.json|msal_token_cache[^/]*)$/, /\/\.kube\/config(-[^/]+)?$/, /\/\.docker\/config\.json$/,
  /\/\.config\/gh\/hosts\.yml$/, /\/\.config\/glab-cli\/config\.yml$/, /\/\.config\/rclone\/rclone\.conf$/,
  /\/\.gnupg\/[^/]+/, /\/\.terraform\.d\/credentials\.tfrc\.json$/,
  /\.tfstate(\.backup)?$/, /\/terraform\.tfvars(\.json)?$/, /\.auto\.tfvars(\.json)?$/,
  /\/\.claude\/\.credentials\.json$/, /\/\.codex\/auth\.json$/, /\/\.gemini\/oauth_creds\.json$/,
  /\/library\/keychains\//, ...SPACED_PATHS,
  // A vault folder counts as a whole, so `tar` or `cp -r` of it is caught.
  /\.kdbx$/, /\/(\.password-store|\.config\/(1password|bitwarden)|\.(lastpass|bitwarden)|\.var\/app\/com\.bitwarden\.desktop)(\/|$)/,
  // Any `environ`: in `/proc/$(pgrep x)/environ` the `$(` splits the path, leaving `/environ`.
  /\/environ$/, /\/run\/secrets\//, /\/etc\/shadow$/, /\/etc\/ssh\/ssh_host_[^/]+_key$/,
]

export const sensitivePath = (path: string, home: string, rules = SENSITIVE_PATHS): boolean => {
  // `$APPDATA` and `$LOCALAPPDATA` (Git Bash) and their `%…%` forms (cmd) become Windows paths, so the AppData rules see them.
  const expanded = path.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home)
    .replace(/^(?:\$\{?|%)(local)?appdata(?:\}|%)?(?=[\\/]|$)/i, (_, local) => `C:\\AppData\\${local ? 'Local' : 'Roaming'}`)
  // A backslash separates directories only in a Windows path; elsewhere it is part of a search pattern (`grep '\.env'`).
  const isWindowsPath = /^(?:[a-z]:\\|\\\\)/i.test(expanded)
  const p = ('/' + (isWindowsPath ? expanded.replace(/\\/g, '/') : expanded)).replace(/\/+/g, '/').toLowerCase()
  return rules.some(r => r.test(p))
}

const SECRET_COMMANDS: readonly RegExp[] = [
  /^(printenv|compgen -v)\b/, /^(env|set|export|export -p|declare -p|declare -x)$/,
  /^security (find-generic-password|find-internet-password|dump-keychain)\b/,
  /^gh auth (token|status .*(-t|--show-token))\b/,
  /^aws (configure (get|export-credentials)|sts get-session-token|secretsmanager get-secret-value|ssm get-parameters?\b.*--with-decryption)/,
  /^gcloud auth (application-default )?print-(access|identity)-token\b/,
  /^az account get-access-token\b/,
  /^kubectl (config view .*--raw|get secrets?\b)/,
  // credential.helper names the helper program, not a secret.
  /^git (credential fill|config .*--get.*credential(?!\.helper\b))/,
  /^(vault (read|kv get)|doppler secrets|heroku auth:token)\b/,
  // Global options can come before the subcommand (`bw --session x get …`). A session key opens the whole vault, so the
  // commands that print one count too.
  /^bw\b(?=.*\s(get|export|receive|unlock)\b|.*\slist\s+items\b)/,
  /^op\b(?=.*\s(read|inject|signin)\b|.*\sdocument\s+get\b|.*\sitems?\s+get\b.*\s--(reveal|otp|format)\b)/,
  /^(echo|printf)\b.*\$\{?[A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL)/i,
]

// The command a segment runs: without leading `NAME=value` assignments or `env` and its options, and without the directory of a
// full path, so `AWS_PROFILE=x aws …`, `env -i printenv` and `/usr/bin/printenv` meet the rules above. Bare `env` stays.
const commandHead = (segment: string) =>
  segment.replace(/^(?:[A-Za-z_]\w*=(?:'[^']*'|"[^"]*"|\S)*\s+|env(?:\s+-[uC]\s+\S+|\s+-\S+)*\s+)+/, '').replace(/^\S*\/(?=\S)/, '')

// Prose names files too (`copy .env.example, then`). Trailing punctuation after a name is dropped, but not after `.` or `/`,
// so `~/.ssh/.` still names the folder.
const withoutTrailingPunctuation = (word: string) => word.replace(/(?<=[^./])[.,;:!?)]+$/, '')

// These touch a credential file without printing what is in it. ssh-keygen and ssh-add print a public key at most.
const NON_READING = new Set(['ls', 'stat', 'test', '[', 'touch', 'chmod', 'chown', 'rm', 'ssh-keygen', 'ssh-add'])

// ssh, scp and sftp read the key given with -i or IdentityFile and print none of it, also in `GIT_SSH_COMMAND="ssh -i …"`.
const isSshKey = (words: string[], index: number) =>
  words.slice(0, index).some(word => /^(ssh|scp|sftp)$/.test(word)) &&
  (/^(-i|identityfile)$/i.test(words[index - 1] ?? '') || /^-i./.test(words[index] ?? ''))

// A commit message, title or body names files without reading them, so its quoted text is not read. In git only -m takes
// text (`-t` names a template file), and a message or body file (`-F`, `--body-file`) is still read.
const QUOTED_TEXT = String.raw`("(?:[^"\\$\x60]|\\.)*"|'[^']*')`
const GIT_MESSAGE = new RegExp(String.raw`(?<=\s(?:-[a-zA-Z]*m|--message)[\s=])${QUOTED_TEXT}`, 'g')
const GH_TEXT = new RegExp(String.raw`(?<=\s(?:-[tbn]|--title|--body|--notes)[\s=])${QUOTED_TEXT}`, 'g')
const withoutProse = (segment: string, head: string) =>
  /^git (commit|tag|merge|stash)\b/.test(head) ? segment.replace(GIT_MESSAGE, '""')
  : /^gh (issue|pr|release) /.test(head) ? segment.replace(GH_TEXT, '""')
  : segment

export const secretCommand = (command: string, home: string): string | undefined => {
  // A script that prints the whole environment is printenv by another name.
  const runnable = withoutDataHeredocs(command)
  if (/\b(console\.log|print|JSON\.stringify|json\.dumps)\(\s*(process\.env|os\.environ)\s*\)/.test(runnable)) return 'printing the whole environment prints secrets'
  for (const seg of commandSegments(runnable)) {
    const head = commandHead(seg)
    if (SECRET_COMMANDS.some(r => r.test(head))) return `\`${head.split(/\s+/).slice(0, 3).join(' ')}\` prints secrets`
    if (jqReadsEnvironment(head)) return '`env` in a jq filter prints the whole environment'
    const text = withoutProse(seg, head)
    const words = pathWords(withoutJqFilter(text))
    const cmd = words[0] ?? ''
    if (NON_READING.has(cmd)) continue
    // cp and mv read only their sources: a credential file as the target is setup, as the source it could be copied out and read.
    const sources = cmd === 'cp' || cmd === 'mv' ? words.slice(1, -1) : words
    const checked = sources.filter((_, index) => !isSshKey(sources, index))
    const token = checked.find(w => sensitivePath(withoutTrailingPunctuation(w), home))
    if (token) return `${token} is a credential file`
    // A quoted sentence ends like many paths (`-m "~/.ssh/config: add a host"`), so a whole quoted word is held only to
    // the rules for paths with spaces, the ones that need one.
    const quotedPath = quotedWords(text).find(word => sensitivePath(word, home, SPACED_PATHS))
    if (quotedPath) return `${quotedPath} is a credential file`
  }
  return undefined
}

const FILE_TOOLS: Record<string, string> = { Read: 'file_path', Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' }
const LOCAL_WRITES = new Set(['Write', 'Edit', 'NotebookEdit'])

const EMITTED_TAG = new RegExp(`\\[secret-guard${': '}(${[...SECRET_RULES.map(([rule]) => rule), 'secret-value'].join('|')})\\]`)

// An old_string holding a tag cannot match the file anyway, so checking every field costs nothing.
export const writesPlaceholder = (args: Record<string, unknown>) => EMITTED_TAG.test(JSON.stringify(args))

const READ_HINT = 'Do not try another way to read it. Use a template such as .env.example, or ask the user to run the step and share only what is safe.'
const SEND_HINT = 'Take the secret out of the call. If the step needs it, ask the user to run it themselves.'
const WRITE_HINT = 'That would replace the real value in the file. Edit only the lines you need and leave hidden values untouched, or ask the user to make the change.'

// Module state starts over on reload; the counts are this load's.
const tally = { hidden: 0, blocked: 0, scrubOff: true }
let home = ''

export const statusText = (t: typeof tally) => {
  const light = t.blocked > 0 ? '🔴' : t.hidden > 0 ? '🟡' : '🟢'
  const parts = [t.hidden > 0 ? `${t.hidden} hidden` : 'none seen', t.blocked > 0 ? `${t.blocked} blocked` : '']
  return `${light} secrets: ${parts.filter(Boolean).join(', ')}${t.scrubOff ? ' · env scrub off' : ''}`
}

function show($: EngineInterface) {
  $.ui.status(statusText(tally))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    tally.scrubOff = (await $.env.get('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB')) !== '1'
    show($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const args = e as Record<string, unknown>
    const deny = (reason: string, hint = READ_HINT) => {
      tally.blocked++
      show($)
      return { deny: `secret-guard: ${reason}. ${hint}` }
    }

    const pathKey = FILE_TOOLS[e.tool]
    const path = pathKey ? args[pathKey] : undefined
    if (typeof path === 'string') {
      if (sensitivePath(path, home)) return deny(`${path} is a credential file`)
      const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
      if (real && sensitivePath(real, home)) return deny(`${path} leads to a credential file`)
    }
    if (e.tool === 'Bash' && typeof args.command === 'string') {
      const reason = secretCommand(args.command, home)
      if (reason) return deny(reason)
    }
    if (!LOCAL_WRITES.has(e.tool) && scrub(JSON.stringify(args)).rules.length > 0) return deny('this call would send a secret', SEND_HINT)
    if (LOCAL_WRITES.has(e.tool) && writesPlaceholder(args)) return deny('this write contains a hidden-value tag', WRITE_HINT)

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const found: string[] = []
    const result = scrubDeep(ran.result, found)
    if (found.length === 0) return ran
    tally.hidden += found.length
    show($)
    return { result, context: ran.context }
  })

  // Every other row: prompts typed or pasted, model output, attachments, compaction summaries, error results.
  // A seated cc-plugin-sec-default sends attachments, hook context, compaction summaries and Skill messages past this hook.
  on('session.append', ($, e, next) => {
    const found: string[] = []
    const content = scrubDeep(e.message.content, found)
    if (found.length === 0) return next(e)
    tally.hidden += found.length
    show($)
    return next({ ...e, message: { ...e.message, content } })
  })
}
