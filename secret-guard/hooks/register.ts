import type { EngineInterface, Register } from 'claude-code'

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
  /^(?<head>\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*\s*=\s*["']?)(?<value>[^\s"'#$<]{12,})/gm,
  // code, JSON, YAML: a quoted literal assigned to a secret-shaped name
  /(?<head>["']?\b[\w.-]*(?:secret|token|password|passwd|api_?key|access_?key|private_?key)["']?\s*[:=]\s*(["']))(?<value>[^"'\s$<{]{12,})(?=\2)/gi,
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

// Matched against the lowercased path with forward slashes and a leading slash.
const SENSITIVE_PATHS: readonly RegExp[] = [
  // `name.env` files, but not the code spellings a search names (`grep -rn process.env src`).
  /\/\.env$/, /\/\.env\.(?!(example|sample|template|defaults|dist)$)[^/]+$/, /\/(?!(process|import\.meta|c)\.env$)[^/]+\.env$/,
  /\/\.envrc$/, /\/\.dev\.vars(\.[^/]+)?$/, /\/\.flaskenv$/,
  /\/\.(aws|gem|cargo|config\/git)\/credentials(\.toml)?$/, /\/credentials\.json$/, /\/service-account[^/]*\.json$/, /\/\.vault-token$/, /\/\.vault_pass$/,
  /\.(key|p12|pfx|jks|keystore|ppk)$/,
  /\/id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/,
  /\/\.ssh\/(?!(known_hosts[^/]*|config|authorized_keys|[^/]+\.pub)$)[^/]+$/,
  /\/\.(npmrc|pypirc|netrc|git-credentials|pgpass|my\.cnf|s3cfg)$/, /\/_netrc$/,
  /\/\.(bash|zsh|sh|python|node_repl|psql|mysql|sqlite)_history$/, /\/\.zhistory$/, /\/fish_history$/,
  /\/\.aws\/(sso|cli)\/cache\//, /\/\.config\/gcloud\/(credentials\.db|access_tokens\.db|application_default_credentials\.json|legacy_credentials\/)/,
  /\/\.azure\/(accesstokens\.json|msal_token_cache[^/]*)$/, /\/\.kube\/config$/, /\/\.docker\/config\.json$/,
  /\/\.config\/gh\/hosts\.yml$/, /\/\.config\/glab-cli\/config\.yml$/, /\/\.config\/rclone\/rclone\.conf$/,
  /\/\.gnupg\/[^/]+/, /\/\.terraform\.d\/credentials\.tfrc\.json$/,
  /\.tfstate(\.backup)?$/, /\/terraform\.tfvars(\.json)?$/, /\.auto\.tfvars(\.json)?$/,
  /\/\.claude\/\.credentials\.json$/, /\/\.codex\/auth\.json$/, /\/\.gemini\/oauth_creds\.json$/,
  /\/library\/keychains\//, /\/library\/(application support|cookies)\/.*\/(login data|cookies|cookies\.sqlite|key4\.db|logins\.json)$/,
  /\/proc\/[^/]+\/environ$/, /\/run\/secrets\//, /\/etc\/shadow$/, /\/etc\/ssh\/ssh_host_[^/]+_key$/,
]

export const sensitivePath = (path: string, home: string): boolean => {
  const expanded = path.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home)
  const p = ('/' + expanded.replace(/\\/g, '/')).replace(/\/+/g, '/').toLowerCase()
  return SENSITIVE_PATHS.some(r => r.test(p))
}

const SECRET_COMMANDS: readonly RegExp[] = [
  /^(printenv|compgen -v)\b/, /^(env|set|export|export -p|declare -p|declare -x)$/,
  /^security (find-generic-password|find-internet-password|dump-keychain)\b/,
  /^gh auth (token|status .*(-t|--show-token))\b/,
  /^aws (configure (get|export-credentials)|sts get-session-token|secretsmanager get-secret-value|ssm get-parameters?\b.*--with-decryption)/,
  /^gcloud auth (application-default )?print-(access|identity)-token\b/,
  /^az account get-access-token\b/,
  /^kubectl (config view .*--raw|get secrets?\b)/,
  /^git (credential fill|config .*--get.*credential)/,
  /^(op read|bw get|vault (read|kv get)|doppler secrets|heroku auth:token)\b/,
  /^(echo|printf)\b.*\$\{?[A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL)/i,
]

// ponytail: plain split on shell operators; sh -c, eval, globs and scripts the model writes pass through. Output scrubbing is the net for those.
// A name right before `(` is a function call (`mock.env(on)`), not a file; `$(` keeps its `$`, so a substitution still splits.
const segments = (command: string) =>
  command.replace(/[\w.-]+\(/g, '(').split(/&&|\|\||[;|\n]|\$\(|`|\(|\)/).map(s => s.trim().replace(/^(sudo|command|exec|time|nohup)\s+/, '')).filter(Boolean)

// These touch a credential file without printing what is in it.
const NON_READING = new Set(['ls', 'stat', 'test', '[', 'touch', 'chmod', 'chown', 'rm'])

export const secretCommand = (command: string, home: string): string | undefined => {
  // A script that prints the whole environment is printenv by another name.
  if (/\b(console\.log|print|JSON\.stringify|json\.dumps)\(\s*(process\.env|os\.environ)\s*\)/.test(command)) return 'printing the whole environment prints secrets'
  for (const seg of segments(command)) {
    if (SECRET_COMMANDS.some(r => r.test(seg))) return `\`${seg.split(/\s+/).slice(0, 3).join(' ')}\` prints secrets`
    const words = seg.split(/\s+|[<>]=?|=/).map(w => w.replace(/^["']|["']$/g, '')).filter(Boolean)
    const cmd = words[0] ?? ''
    if (NON_READING.has(cmd)) continue
    // cp and mv read only their sources: a credential file as the target is setup, as the source it could be copied out and read.
    const checked = cmd === 'cp' || cmd === 'mv' ? words.slice(1, -1) : words
    const token = checked.find(w => sensitivePath(w, home))
    if (token) return `${token} is a credential file`
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

const denied = (reason: string, hint = READ_HINT) => `secret-guard: ${reason}. ${hint}`

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
    const deny = (reason: string, hint?: string) => {
      tally.blocked++
      show($)
      return { deny: denied(reason, hint) }
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

  // Every other row: prompts the person pastes, model output, attachments, compaction summaries, error results.
  on('session.append', ($, e, next) => {
    const found: string[] = []
    const content = scrubDeep(e.message.content, found)
    if (found.length === 0) return next(e)
    tally.hidden += found.length
    show($)
    return next({ ...e, message: { ...e.message, content } })
  })
}
