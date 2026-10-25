import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { ENV_CHECK_TOOL, envNames, envReport, isEnvFile, SET_NOTE } from '../hooks/env-check'
import { scrub } from '../hooks/register'

// Every value holds "v4lue" or "MIIE", so a test can check that none reaches a result.
const FILE = [
  'export API_KEY=v4lue-one', 'DB_PASSWORD="v4lue two"', 'EMPTY=', 'QUOTED_EMPTY=""', "BLANK='  '", 'COMMENTED=v4lue3 # note',
  'ONLY_COMMENT= # none yet', 'PEM_KEY="-----BEGIN KEY', 'MIIEowAbcDef==', '-----END KEY"', 'lower_case=v4lue4',
  'TWICE=v4lue5', 'TWICE=', '# OLD=v4lue6', 'not an assignment',
].join('\n')
const TEMPLATE = 'API_KEY=\nDB_PASSWORD=\nSTRIPE_KEY=\n'
const FILES: Record<string, string> = { '.env': FILE, '.env.example': TEMPLATE, '.env.dist': 'API_KEY=\n', '.envrc': 'export DIRENV_KEY=v4lue7\n',
  '.envrc.example': 'DIRENV_KEY=\n' }

test('each name is set, empty or missing, and a later line wins', () => {
  expect(Object.fromEntries(envNames(FILE))).toEqual({ API_KEY: 'set', DB_PASSWORD: 'set', EMPTY: 'empty', QUOTED_EMPTY: 'empty',
    BLANK: 'empty', COMMENTED: 'set', ONLY_COMMENT: 'empty', PEM_KEY: 'set', lower_case: 'set', TWICE: 'empty' })
  // A dotted name still starts the skip, so the key's last line never reads as a name.
  expect(Object.fromEntries(envNames('my.key="-----BEGIN KEY\nABCD1234==\n-----END KEY"\nFOO.BAR=v4lue\nmy-var=')))
    .toEqual({ 'my.key': 'set', 'FOO.BAR': 'set', 'my-var': 'empty' })
  // As in a shell, a `#` starts a comment only after a space.
  expect(Object.fromEntries(envNames('HASH=#v4lue\nTAB=\t# none\nMID=v4lue#8\nSPACED= ""\nSPACED_SET= "v4lue"')))
    .toEqual({ HASH: 'set', TAB: 'empty', MID: 'set', SPACED: 'empty', SPACED_SET: 'set' })
})

test('the report gives each name a state, never a value, and a note when one is set', () => {
  const r = envReport('.env', FILE, { name: '.env.example', text: TEMPLATE })
  const extra = ['EMPTY: empty', 'QUOTED_EMPTY: empty', 'BLANK: empty', 'COMMENTED: set', 'ONLY_COMMENT: empty', 'PEM_KEY: set', 'TWICE: empty']
  expect(r).toBe(['.env, compared with .env.example', 'API_KEY: set', 'DB_PASSWORD: set', 'STRIPE_KEY: missing',
    ...extra.map(row => `${row}, not in template`), SET_NOTE].join('\n'))
  expect(r).not.toMatch(/v4lue|MIIE/)
  expect(envReport('.env', FILE, undefined, ['DB_PASSWORD', 'lower_case', 'NOPE'])).toBe(`.env, no template found\nDB_PASSWORD: set\nlower_case: set\nNOPE: missing\n${SET_NOTE}`)
  expect(envReport('.env', '', undefined)).toBe('.env, no template found\nno variables')
  expect(envReport('.env', 'EMPTY=', undefined, ['EMPTY', 'NOPE'])).toBe('.env, no template found\nEMPTY: empty\nNOPE: missing')
  expect(envReport('.env', FILE, { name: '.env.example', text: TEMPLATE }, [])).toBe(r)
  // The template's names are held to capitals too: Claude can name any env file as the template.
  expect(envReport('.env', 'API_KEY=v4lue', { name: '.env.local', text: 'API_KEY=v4lue\nAb12Cd34==\n' })).toBe(`.env, compared with .env.local\nAPI_KEY: set\n${SET_NOTE}`)
  expect(scrub(r).rules).toEqual([])
  expect(scrub(envReport('.env', 'REDIS_AUTH=a\nDB_PASS=b\nGITHUB_TOKEN=c', undefined)).rules).toEqual([])
})

test('only .env-style files are read', () => {
  for (const p of ['.env', '.env.local', 'app/.env.production', 'prod.env', '.dev.vars', '.dev.vars.example', '.envrc', '.flaskenv', '~/x/.env'])
    expect(isEnvFile(p)).toBe(true)
  // A template is not read as the file: it goes in template.
  for (const p of ['~/.ssh/id_rsa', 'config.json', '.environment', 'credentials', 'notes.txt', '.env.example', '.env.dist', 'process.env'])
    expect(isEnvFile(p)).toBe(false)
})

// The engine hands an op the path resolved against the working directory.
const fileAt = (path: string) => Object.entries(FILES).find(([name]) => path.endsWith(`/${name}`))?.[1]

// Answers the file system from FILES and returns the paths looked for.
const answerFs = (on: Parameters<TestBody>[1]) => {
  const looked: string[] = []
  on('fs.exists', (_$, e) => (looked.push(e.path), { value: fileAt(e.path) !== undefined }))
  on('fs.read', (_$, e) => { const text = fileAt(e.path); return text === undefined ? { deny: 'missing' } : { value: text } })
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false, realPath: e.path } }))
  return looked
}

test('the tool answers from the file and its template', async ($, on) => {
  answerFs(on)
  const r = await $.tool.call({ tool: ENV_CHECK_TOOL, names: ['DB_PASSWORD', 'STRIPE_KEY'] })
  expect(r.result).toBe(`.env, compared with .env.example\nDB_PASSWORD: set\nSTRIPE_KEY: missing\n${SET_NOTE}`)
  expect((await $.tool.call({ tool: ENV_CHECK_TOOL, names: [] })).result).toContain('\nAPI_KEY: set\n')
  expect((await $.tool.call({ tool: ENV_CHECK_TOOL, file: '.envrc' })).result).toBe(`.envrc, compared with .envrc.example\nDIRENV_KEY: set\n${SET_NOTE}`)
  expect((await $.tool.call({ tool: ENV_CHECK_TOOL, template: '.env.dist', names: ['API_KEY'] })).result)
    .toBe(`.env, compared with .env.dist\nAPI_KEY: set\n${SET_NOTE}`)
  expect((await $.tool.call({ tool: ENV_CHECK_TOOL, file: 'prod.env' })).result).toBe('prod.env does not exist')
})

test('a ~ path stays as typed in the answer, so the home folder is not shown', async ($, on) => {
  mock.env(on, { HOME: '/Users/me' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  const looked = answerFs(on)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: true })
  expect((await $.tool.call({ tool: ENV_CHECK_TOOL, file: '~/app/.env', names: ['API_KEY'] })).result)
    .toBe(`~/app/.env, compared with ~/app/.env.example\nAPI_KEY: set\n${SET_NOTE}`)
  expect((await $.tool.call({ tool: ENV_CHECK_TOOL, file: '~/app/prod.env' })).result).toBe('~/app/prod.env does not exist')
  expect(looked).toContain('/Users/me/app/.env')
  expect(looked.filter(p => p.includes('~'))).toEqual([])
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
