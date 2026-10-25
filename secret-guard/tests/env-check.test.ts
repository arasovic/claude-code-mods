import { expect, test } from 'claude-code/testing'

import { ENV_CHECK_TOOL, envNames, envReport, isEnvFile } from '../hooks/env-check'
import { scrub } from '../hooks/register'

// Every value holds "v4lue" or "MIIE", so a test can check that none reaches a result.
const FILE = [
  'export API_KEY=v4lue-one', 'DB_PASSWORD="v4lue two"', 'EMPTY=', 'QUOTED_EMPTY=""', "BLANK='  '", 'COMMENTED=v4lue3 # note',
  'ONLY_COMMENT= # none yet', 'PEM_KEY="-----BEGIN KEY', 'MIIEowAbcDef==', '-----END KEY"', 'lower_case=v4lue4',
  'TWICE=v4lue5', 'TWICE=', '# OLD=v4lue6', 'not an assignment',
].join('\n')
const TEMPLATE = 'API_KEY=\nDB_PASSWORD=\nSTRIPE_KEY=\n'
const FILES: Record<string, string> = { '.env': FILE, '.env.example': TEMPLATE, '.envrc': 'export DIRENV_KEY=v4lue7\n', '.envrc.example': 'DIRENV_KEY=\n' }

test('each name is set, empty or missing, and a later line wins', () => {
  expect(Object.fromEntries(envNames(FILE))).toEqual({ API_KEY: 'set', DB_PASSWORD: 'set', EMPTY: 'empty', QUOTED_EMPTY: 'empty',
    BLANK: 'empty', COMMENTED: 'set', ONLY_COMMENT: 'empty', PEM_KEY: 'set', lower_case: 'set', TWICE: 'empty' })
  // A dotted name still starts the skip, so the key's last line never reads as a name.
  expect(Object.fromEntries(envNames('my.key="-----BEGIN KEY\nABCD1234==\n-----END KEY"\nFOO.BAR=v4lue\nmy-var=')))
    .toEqual({ 'my.key': 'set', 'FOO.BAR': 'set', 'my-var': 'empty' })
})

test('the report gives each name a state, never a value, and secret-guard leaves it whole', () => {
  const r = envReport('.env', FILE, { name: '.env.example', text: TEMPLATE })
  const extra = ['EMPTY: empty', 'QUOTED_EMPTY: empty', 'BLANK: empty', 'COMMENTED: set', 'ONLY_COMMENT: empty', 'PEM_KEY: set', 'TWICE: empty']
  expect(r).toBe(['.env, compared with .env.example', 'API_KEY: set', 'DB_PASSWORD: set', 'STRIPE_KEY: missing',
    ...extra.map(row => `${row}, not in template`)].join('\n'))
  expect(r).not.toMatch(/v4lue|MIIE/)
  expect(envReport('.env', FILE, undefined, ['DB_PASSWORD', 'lower_case', 'NOPE'])).toBe('.env, no template found\nDB_PASSWORD: set\nlower_case: set\nNOPE: missing')
  expect(envReport('.env', '', undefined)).toBe('.env, no template found\nno variables')
  expect(envReport('.env', FILE, { name: '.env.example', text: TEMPLATE }, [])).toBe(r)
  // The template's names are held to capitals too: Claude can name any env file as the template.
  expect(envReport('.env', 'API_KEY=v4lue', { name: '.env.local', text: 'API_KEY=v4lue\nAb12Cd34==\n' })).toBe('.env, compared with .env.local\nAPI_KEY: set')
  expect(scrub(r).rules).toEqual([])
  expect(scrub(envReport('.env', 'REDIS_AUTH=a\nDB_PASS=b\nGITHUB_TOKEN=c', undefined)).rules).toEqual([])
})

test('only .env-style files are read', () => {
  for (const p of ['.env', '.env.local', 'app/.env.production', 'prod.env', '.dev.vars', '.dev.vars.example', '.envrc', '.flaskenv', '~/x/.env'])
    expect(isEnvFile(p)).toBe(true)
  for (const p of ['~/.ssh/id_rsa', 'config.json', '.environment', 'credentials', 'notes.txt'])
    expect(isEnvFile(p)).toBe(false)
})

// The engine hands an op the path resolved against the working directory.
const fileAt = (path: string) => Object.entries(FILES).find(([name]) => path.endsWith(`/${name}`))?.[1]

test('the tool answers from the file and its template', async ($, on) => {
  on('fs.exists', (_$, e) => ({ value: fileAt(e.path) !== undefined }))
  on('fs.read', (_$, e) => { const text = fileAt(e.path); return text === undefined ? { deny: 'missing' } : { value: text } })
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  const r = await $.tool.call({ tool: ENV_CHECK_TOOL, names: ['DB_PASSWORD', 'STRIPE_KEY'] })
  expect(r.result).toBe('.env, compared with .env.example\nDB_PASSWORD: set\nSTRIPE_KEY: missing')
  expect((await $.tool.call({ tool: ENV_CHECK_TOOL, names: [] })).result).toContain('\nAPI_KEY: set\n')
  expect((await $.tool.call({ tool: ENV_CHECK_TOOL, file: '.envrc' })).result).toBe('.envrc, compared with .envrc.example\nDIRENV_KEY: set')
  expect((await $.tool.call({ tool: ENV_CHECK_TOOL, file: 'prod.env' })).result).toBe('prod.env does not exist')
})

test('any other file, or a link to one, is refused before it is read', async ($, on) => {
  const reads: string[] = []
  on('fs.exists', () => ({ value: true }))
  on('fs.read', (_$, e) => (reads.push(e.path), { value: '' }))
  on('fs.stat', (_$, e) => e.path.endsWith('/gone/.env') ? { deny: 'ENOENT' } : { value: { kind: 'file' as const, size: 1, mtimeMs: 0,
    isLink: true, ...(e.path.endsWith('/withheld/.env') ? {} : { realPath: e.path.endsWith('/link/.env') ? '/Users/me/.ssh/id_rsa' : e.path }) } })
  for (const args of [{ file: '~/.ssh/id_rsa' }, { file: 'link/.env' }, { template: 'notes.txt' }, { template: 'id_rsa.example' }])
    expect(JSON.stringify(await $.tool.call({ tool: ENV_CHECK_TOOL, ...args }))).toContain('reads only .env-style files')
  // A link it cannot resolve is not read either.
  for (const file of ['gone/.env', 'withheld/.env'])
    expect((await $.tool.call({ tool: ENV_CHECK_TOOL, file })).result).toBe(`env_check could not read ${file}`)
  expect(reads).toEqual([])
})

test('a key in its arguments is refused before the file is looked for', async ($, on) => {
  let isLooked = false
  on('fs.exists', () => ((isLooked = true), { value: true }))
  const r = await $.tool.call({ tool: ENV_CHECK_TOOL, names: ['ghp_' + 'a1'.repeat(18)] })
  expect(r.deny).toContain('would send a secret')
  expect(isLooked).toBe(false)
})
