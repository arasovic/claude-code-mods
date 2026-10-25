import type { FsEntry } from 'claude-code'
import { expect, mock, test, type TestBody } from 'claude-code/testing'

const entry = (name: string, kind: FsEntry['kind'] = 'file', isLink = false): FsEntry => ({ name, kind, size: 0, mtimeMs: 0, isLink })
// A file system in memory: folders by real path, and links by where they stand.
const TREE: Record<string, FsEntry[]> = {
  '/w': [entry('.env'), entry('.env.example'), entry('notes', 'other', true), entry('docs', 'dir'), entry('awsdir', 'other', true), entry('src', 'dir')],
  '/w/docs': [entry('a.md')],
  '/w/src': Array.from({ length: 40 }, (_, at) => entry(`f${at}.ts`)),
  '/Users/me': [entry('.aws', 'dir'), entry('.awsx', 'dir')],
  '/Users/me/.aws': [entry('credentials'), entry('config')],
  '/Users/me/.awsx': [],
}
const LINKS: Record<string, string> = { '/w/notes': '/w/.env', '/w/awsdir': '/Users/me/.aws' }
const realOf = (path: string) => {
  const link = Object.keys(LINKS).find(from => path === from || path.startsWith(`${from}/`))
  return link ? `${LINKS[link]}${path.slice(link.length)}` : path
}
const exists = (path: string) => {
  const real = realOf(path)
  const cut = real.lastIndexOf('/')
  return real in TREE || (TREE[real.slice(0, cut) || '/'] ?? []).some(e => e.name === real.slice(cut + 1))
}

// Starts a session in /w and answers the file system, counting each call.
const setUp = async (...[$, on]: Parameters<TestBody>) => {
  const calls: string[] = []
  const toasts: string[] = []
  mock.env(on, { HOME: '/Users/me' })
  on('fs.list', (_$, e) => {
    calls.push(`list ${e.path}`)
    const entries = TREE[realOf(e.path)]
    return entries ? { value: entries } : { deny: 'ENOENT' }
  })
  on('fs.stat', (_$, e) => {
    calls.push(`stat ${e.path}`)
    return exists(e.path)
      ? { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: e.path in LINKS, ...(e.resolve ? { realPath: realOf(e.path) } : {}) } }
      : { deny: 'ENOENT' }
  })
  on('tool.call', () => ({ result: 'ran' }))
  on('prompt.mention', () => ({ type: 'file' as const }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  await $.session.start({ cwd: '/w', surface: null, isInteractive: true })
  const bash = async (command: string) => (await $.tool.call({ tool: 'Bash', command })).deny
  return { calls, toasts, bash }
}

test('a glob or a brace that matches a credential file is refused', async ($, on) => {
  const { calls, bash } = await setUp($, on)
  expect(await bash('cat /w/.env*')).toContain('/w/.env* matches a credential file')
  expect(await bash('cat ~/.aw?/credentials')).toContain('~/.aw?/credentials matches a credential file')
  expect(await bash('cd /w && head -5 .e[n]v')).toContain('.e[n]v matches a credential file')
  calls.length = 0
  // A brace spells the name out, so no call is needed.
  expect(await bash('cat /w/.{env,bashrc}')).toContain('/w/.{env,bashrc} matches a credential file')
  expect(calls).toEqual([])
  expect(await bash('cat /w/src/*.ts /w/*.example')).toBeUndefined()
})

test('a link, or a folder reached through one, that leads to a credential file is refused', async ($, on) => {
  const { bash } = await setUp($, on)
  // The deny names the word typed, never where it leads.
  expect(await bash('cat /w/notes')).toMatch(/^secret-guard: \/w\/notes leads to a credential file\. Do not/)
  expect(await bash('cat /w/awsdir/credentials')).toContain('leads to a credential file')
  expect(await bash('cat /w/awsdir/cred*')).toContain('leads to a credential file')
  expect(await bash('cat /w/no*')).toContain('/w/no* leads to a credential file')
  expect(await bash('cd /w && wc -l {docs,notes}')).toContain('{docs,notes} leads to a credential file')
})

test('quoted words, options, listings, echo and missing files make no call or pass', async ($, on) => {
  const { calls, bash } = await setUp($, on)
  for (const command of [`grep -rn '/w/.env*' /w/docs`, 'grep -rn /w/.env\\* /w/docs', 'ls -la /w/.e*', 'echo /w/notes', `cat /w/missing`, 'grep -r --include=*.md x /w/docs',
    `python3 -c "${Array.from({ length: 40 }, (_, at) => `w${at}/x`).join(' ')}"`])
    expect(await bash(command)).toBeUndefined()
  expect(calls.filter(call => call.includes('/w/.e') || call.includes('/notes'))).toEqual([])
})

test('a command that needs more than 32 calls is refused, a smaller one passes', async ($, on) => {
  const { calls, bash } = await setUp($, on)
  const words = (count: number) => Array.from({ length: count }, (_, at) => `/w/docs/n${at}`).join(' ')
  expect(await bash(`cat ${words(31)}`)).toBeUndefined()
  calls.length = 0
  expect(await bash(`cat ${words(40)}`)).toContain('needs more than 32 file system checks. Split it')
  expect(calls).toHaveLength(32)
})

test('a credential file added with @, by name or through a link, is not attached', async ($, on) => {
  const { toasts } = await setUp($, on)
  expect(await $.prompt.mention({ mention: '.env', path: '/w/.env' })).toHaveProperty('deny')
  expect(await $.prompt.mention({ mention: 'notes', path: '/w/notes' })).toHaveProperty('deny')
  expect(await $.prompt.mention({ mention: '.env.example', path: '/w/.env.example' })).not.toHaveProperty('deny')
  expect(toasts).toEqual(['@.env was not attached, because it is a credential file.', '@notes was not attached, because it is a credential file.'])
})
