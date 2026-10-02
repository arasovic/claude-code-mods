import { expect, test } from 'claude-code/testing'

import { ago, lineDelta, parseNumstat, parseStatus, statBar } from '../hooks/register'

test('an edit counts only the lines that differ', () => {
  expect(lineDelta('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 })
  expect(lineDelta('a\nc', 'a\nb\nc')).toEqual({ added: 1, removed: 0 })
  expect(lineDelta('x', 'x\ny\nz')).toEqual({ added: 2, removed: 0 })
  expect(lineDelta('a\nb', 'c')).toEqual({ added: 1, removed: 2 })
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
