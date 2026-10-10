import { expect, mock, test } from 'claude-code/testing'
import type { LedgerFile, LedgerGit } from '../types'

import { ago, folder, lineDelta, lines, parseNumstat, parseStatus, statBar } from '../hooks/register'

test('an edit counts only the lines that differ', () => {
  expect(lineDelta('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 })
  expect(lineDelta('a\nc', 'a\nb\nc')).toEqual({ added: 1, removed: 0 })
  expect(lineDelta('x', 'x\ny\nz')).toEqual({ added: 2, removed: 0 })
  expect(lineDelta('a\nb', 'c')).toEqual({ added: 1, removed: 2 })
})

test('a new file counts its lines as git does, the final newline ending the last line', () => {
  expect(lines('a\nb\nc\nd\n')).toBe(4)
  expect(lines('a\nb\nc\nd')).toBe(4)
  expect(lines('\n')).toBe(1)
  expect(lines('')).toBe(0)
})

test('the folder label shortens only paths outside the session folder with more than two folders', () => {
  expect(folder('/tmp/pane-test/c.md', '/Users/me/app')).toBe('/tmp/pane-test/')
  expect(folder('/Users/me/lib/src/util/x.ts', '/Users/me/app')).toBe('…/src/util/')
  expect(folder('/Users/me/app/src/a/b/c.ts', '/Users/me/app')).toBe('src/a/b/')
  expect(folder('/Users/me/app/a.txt', '/Users/me/app')).toBe('./')
})

test('git status and numstat parsing', () => {
  const s = parseStatus('## main...origin/main [ahead 2, behind 1]\n M hooks/register.tsx\n?? notes.md\nR  old.ts -> new.ts\n')
  expect(s).toEqual({
    branch: 'main',
    ahead: 2,
    behind: 1,
    entries: [
      { status: 'M', path: 'hooks/register.tsx' },
      { status: '??', path: 'notes.md' },
      { status: 'R', path: 'new.ts' },
    ],
  })
  expect(parseStatus('## No commits yet on main\n').branch).toBe('main')
  const n = parseNumstat('12\t3\thooks/register.tsx\n-\t-\tdocs/a.png\n')
  expect(n.get('hooks/register.tsx')).toEqual({ added: 12, removed: 3 })
  expect(n.has('docs/a.png')).toBe(false)
})

test('the stat bar scales to the largest change and keeps a cell for a tiny one', () => {
  expect(statBar(30, 10, 40, 8)).toEqual({ plus: 6, minus: 2, rest: 0 })
  expect(statBar(1, 0, 400, 8)).toEqual({ plus: 1, minus: 0, rest: 7 })
  expect(statBar(0, 0, 10, 8)).toEqual({ plus: 0, minus: 0, rest: 8 })
  expect(ago(90_000)).toBe('1m ago')
})

const PANE = { title: 'Changes', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

test('off the terminal only paths, folders, agents and the branch give way', async ($, on) => {
  mock.clock(on, { now: 90_000 })
  on('session.cwd', () => ({ value: '/repo' }))
  const files: LedgerFile[] = [
    { path: '/repo/src/components/settings/a-rather-long-file-name.tsx', added: 120, removed: 30, edits: 3, at: 0, agents: ['main', 'general-purpose'], created: true },
  ]
  const git: LedgerGit = {
    root: '/repo',
    branch: 'fix/a-branch-name-long-enough-to-run-past-the-pane',
    ahead: 2,
    behind: 1,
    files: [{ status: '??', path: 'notes/an-untracked-file-with-a-long-name.md' }],
  }
  const held: Record<string, unknown> = { files, git }
  on('state.get', (_$, e) => ({ value: { value: held[e.key], version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'change-ledger', surface: 'desktop', component: 'Pane', props: PANE, requestId: 'changes' })
  const texts = (await ui.findAll({ type: 'Text' })).map(r => r.text)
  const kept = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexShrink === 0).map(b => b.text)
  await ui.unmount()
  // The long parts arrive whole for the surface to cut.
  for (const t of ['   fix/a-branch-name-long-enough-to-run-past-the-pane', 'notes/an-untracked-file-with-a-long-name.md', 'main, general-purpose']) expect(texts).toContain(t)
  for (const t of ['1 file  ', '+120', ' −30', ' ↑2', ' ↓1', 'Edits', ' new', ' · 3× · 1m ago', 'Working tree', 'new']) expect(kept).toContain(t)
})
