import type { EngineInterface, ToolSpec } from 'claude-code'

export const ENV_CHECK_TOOL = 'mcp__secret-guard__env_check'

export const envCheckSpec: ToolSpec = {
  name: 'env_check',
  description: 'Says whether a .env-style file sets each variable (set, empty or missing) and whether its template lists it. ' +
    'It never shows a value or its length. Use it instead of reading the file, which secret-guard blocks.',
  inputSchema: {
    type: 'object',
    properties: {
      names: { type: 'array', items: { type: 'string' }, description: 'The variables to check. Leave out to list the template\'s names and the file\'s own.' },
      file: { type: 'string', description: 'The env file, .env by default: .env, .env.*, *.env, .dev.vars, .envrc or .flaskenv.' },
      template: { type: 'string', description: 'The template to compare with. By default <file>.example, .sample or .template, then .env.example beside the file.' },
    },
    additionalProperties: false,
  },
}

// secret-guard's env file rules, matched against the lowercased path with forward slashes and a leading slash.
export const ENV_PATHS: readonly RegExp[] = [
  // `name.env` files, but not the code spellings a search names (`grep -rn process.env src`).
  /\/\.env$/, /\/\.env\.(?!(example|sample|template|defaults|dist)$)[^/]+$/, /\/(?!(process|import\.meta|c)\.env$)[^/\\]+\.env$/,
  /\/\.envrc$/, /\/\.dev\.vars(\.[^/]+)?$/, /\/\.flaskenv$/,
]

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path
export const isEnvFile = (path: string) => ENV_PATHS.some(r => r.test('/' + baseName(path).toLowerCase()))
// A template such as .envrc.example is judged by the file it is named for.
const isEnvTemplate = (path: string) => isEnvFile(path.replace(/\.(?:example|sample|template|defaults|dist)$/i, ''))

// Dots and dashes are allowed in a name, so a quoted key after `my.key=` starts the skip below. The space after `=` is kept:
// `X=#v` has a value, while in `X= #v` the `#` starts a comment.
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=(\s*)(.*)$/

// In double quotes a backslash escapes the next character.
const closingQuote = (text: string, quote: string) => {
  for (let i = 0; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') i++
    else if (text[i] === quote) return i
  }
  return -1
}

// Each assigned name and whether it has a value; a later line wins. A quoted value can run over several lines (a PEM key):
// those lines are skipped, so a key's base64 never reads as a name.
export const envNames = (text: string): Map<string, 'set' | 'empty'> => {
  const names = new Map<string, 'set' | 'empty'>()
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = ASSIGNMENT.exec(lines[i]!)
    if (!m) continue
    const name = m[1]!, gap = m[2]!, value = m[3]!
    const quote = value[0]
    if (quote === '"' || quote === "'" || quote === '`') {
      const end = closingQuote(value.slice(1), quote)
      if (end < 0) while (++i < lines.length && closingQuote(lines[i]!, quote) < 0);
      names.set(name, end >= 0 && value.slice(1, end + 1).trim() === '' ? 'empty' : 'set')
    } else names.set(name, (gap + value).replace(/\s#.*$/, '').trim() === '' ? 'empty' : 'set')
  }
  return names
}

// Unasked, names are listed only in capitals, the template's too: a key pasted unquoted over several lines can leave a
// base64 line that parses as a mixed-case name.
const LISTED_NAME = /^[A-Z_][A-Z0-9_]*$/

export const SET_NOTE = '"set" means only that the line has a value, which can be a placeholder copied from the template. ' +
  'env_check cannot tell whether the value is correct.'

export const envReport = (fileName: string, text: string, template?: { name: string; text: string }, asked?: readonly string[]) => {
  const values = envNames(text)
  const listed = template && envNames(template.text)
  const names = asked?.length ? asked : [...new Set([...(listed?.keys() ?? []), ...values.keys()])].filter(n => LISTED_NAME.test(n))
  const head = `${fileName}, ${template ? `compared with ${template.name}` : 'no template found'}`
  const rows = names.map(n => `${n}: ${values.get(n) ?? 'missing'}${listed && !listed.has(n) ? ', not in template' : ''}`)
  const note = names.some(n => values.get(n) === 'set') ? [SET_NOTE] : []
  return [head, ...(rows.length > 0 ? rows : ['no variables']), ...note].join('\n')
}

const ONLY_ENV_FILES = 'env_check reads only .env-style files: .env, .env.*, *.env, .dev.vars, .envrc and .flaskenv. ' +
  'A template such as .env.example goes in template.'

export async function envCheck($: EngineInterface, home: string, args: Record<string, unknown>) {
  // Paths stay as typed in every result, so a `~` path does not show the home folder.
  const expand = (path: string) => path.replace(/^~(?=\/|$)/, home)
  const file = typeof args.file === 'string' ? args.file : '.env'
  const given = typeof args.template === 'string' ? args.template : undefined
  const asked = Array.isArray(args.names) ? args.names.filter((n): n is string => typeof n === 'string') : undefined
  // Any other file, such as a key, could parse as names. The name is judged before the file is looked for, so the tool
  // does not tell whether some other file exists.
  if (!isEnvFile(file) || (given !== undefined && !isEnvTemplate(given))) return { isError: true as const, result: ONLY_ENV_FILES }
  if (!(await $.fs.exists(expand(file)))) return { result: `${file} does not exist` }
  const dir = file.slice(0, file.length - baseName(file).length)
  const candidates = given !== undefined ? [given] : [`${file}.example`, `${file}.sample`, `${file}.template`, `${dir}.env.example`]
  let template: string | undefined
  for (const c of candidates) if (template === undefined && (await $.fs.exists(expand(c)))) template = c
  if (given !== undefined && template === undefined) return { isError: true as const, result: `${given} does not exist` }
  // A link is judged by the file it leads to. Without that real path the file is not read.
  for (const [path, isAllowed] of [[file, isEnvFile], [template, isEnvTemplate]] as const) {
    if (path === undefined) continue
    const real = (await $.fs.stat(expand(path), { resolve: true }).catch(() => undefined))?.realPath
    if (real === undefined) return { isError: true as const, result: `env_check could not read ${path}` }
    if (!isAllowed(real)) return { isError: true as const, result: ONLY_ENV_FILES }
  }
  try {
    const text = await $.fs.read(expand(file))
    const shape = template === undefined ? undefined : { name: template, text: await $.fs.read(expand(template)) }
    return { result: envReport(file, text, shape, asked) }
  } catch {
    // The engine's error text is not passed on.
    return { isError: true as const, result: `env_check could not read ${file}${template ? ` or ${template}` : ''}` }
  }
}
