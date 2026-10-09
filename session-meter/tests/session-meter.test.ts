import { expect, mock, test } from 'claude-code/testing'

import { braille, cells, checkReset, cross, duration, elapsed, fit, heaviest, levels, meter, note, pace, readOptions, target, tokens, toolName } from '../hooks/register'

const at = (context: number | null, fiveHour?: number, sevenDay?: number) => ({
  context,
  limits: [
    ...(fiveHour === undefined ? [] : [{ kind: 'five_hour', percentUsed: fiveHour, resetsAt: '2026-10-02T10:00:00Z' }]),
    ...(sevenDay === undefined ? [] : [{ kind: 'seven_day', percentUsed: sevenDay, resetsAt: '2026-10-04T21:00:00Z' }]),
  ],
})

test('a level fires once, stays quiet, and re-arms only after a real drop', () => {
  const first = cross(at(30, 82, 40), [])
  expect(first.fresh.map(l => l.id)).toEqual(['five_hour:80'])
  expect(cross(at(30, 95, 40), first.fired).fresh).toEqual([])
  const afterReset = cross(at(30, 5, 40), first.fired)
  expect(afterReset.fired).toEqual([])
  expect(cross(at(30, 81, 40), afterReset.fired).fresh.map(l => l.id)).toEqual(['five_hour:80'])
  expect(cross(at(30, 75, 40), first.fired).fired).toEqual(['five_hour:80'])
  expect(cross(at(30, undefined, 40), first.fired).fired).toEqual(['five_hour:80'])
})

test('both 7-day levels crossing at once make one line; context gets the compact vs fresh-session rule', () => {
  const now = Date.parse('2026-10-02T08:30:00Z')
  const crossed = cross(at(64, 10, 92), [])
  expect(crossed.fresh.map(l => l.id)).toEqual(['seven_day:80', 'seven_day:90', 'context:60'])
  const text = note(at(64, 10, 92), crossed.fresh, now)
  expect(text.split('\n').length).toBe(3)
  expect(text).toContain('7-day usage window is at 92% (resets in 2d12h)')
  expect(text).toContain('context window is 64% full')
  expect(text).toContain('/compact')
  expect(duration(90 * 60_000)).toBe('1h30m')
  expect(duration(-5)).toBe('0m')
})

test('contextAt moves the context level, and contextAction turns the note into a call to context_reset', () => {
  const now = Date.parse('2026-10-02T08:30:00Z')
  expect(cross(at(64), [], levels(70)).fresh).toEqual([])
  const crossed = cross(at(72), [], levels(70))
  expect(crossed.fresh.map(l => l.id)).toEqual(['context:70'])
  const text = note(at(72), crossed.fresh, now, 'compact')
  expect(text).toContain('context window is 72% full')
  expect(text).toContain('call the context_reset tool yourself')
  expect(text).not.toContain('suggest /compact')
})

test('checkReset needs next for a compact and a full handoff for a clear, and clear only when allowed', () => {
  const handoff = 'Goal: ship the parser. Done: tokenizer and tests. Decisions: no new dependency. Files: src/parse.ts, tests/parse.test.ts. Next: wire the parser into the CLI and run the full test suite before the commit.'
  expect(checkReset({ mode: 'compact', next: ' run the tests ' }, 'compact')).toEqual({ mode: 'compact', next: 'run the tests' })
  expect(checkReset({ mode: 'compact' }, 'compact')).toContain('Give `next`')
  expect(checkReset({ mode: 'clear', handoff }, 'compact')).toBe('mode must be "compact".')
  expect(checkReset({ mode: 'clear', handoff: 'do the rest' }, 'compact-or-clear')).toContain('at least 200 characters')
  expect(checkReset({ mode: 'clear', handoff }, 'compact-or-clear')).toEqual({ mode: 'clear', handoff })
})

test('readOptions falls back to suggest and 60 for values outside the manifest', () => {
  expect(readOptions({ contextAction: 'compact-or-clear', contextAt: 75 })).toEqual({ action: 'compact-or-clear', contextAt: 75 })
  expect(readOptions({ contextAction: 'compat', contextAt: 'x' })).toEqual({ action: 'suggest', contextAt: 60 })
  expect(readOptions({ contextAt: 5 })).toEqual({ action: 'suggest', contextAt: 60 })
  expect(readOptions({})).toEqual({ action: 'suggest', contextAt: 60 })
})

test('cells, braille chart, meter and token format', () => {
  expect(cells(50, 100, 16)).toBe(8)
  expect(cells(5, 0, 16)).toBe(0)
  expect(braille([8, 4], 8, 4, 2)).toEqual(['⡇', '⣿'])
  expect(braille([0, 8], 8, 4, 2)).toEqual(['⢸', '⢸'])
  expect(braille([1, 2, 3, 4, 5, 6], 6, 2, 1)).toEqual(['⣴⣾'])
  expect(meter(50, 4).map(s => s.t).join('')).toBe('██··')
  expect(meter(100, 10).map(s => s.c)).toEqual(['success', 'warning', 'error'])
  expect(meter(5, 10).map(s => s.t).join('')).toBe('▌·········')
  expect(elapsed(1234)).toBe('1.2s')
  expect(elapsed(65_000)).toBe('1m5s')
  expect(tokens(12_345)).toBe('12.3k')
  expect(tokens(162_900)).toBe('163k')
  expect(tokens(800)).toBe('800')
})

test('pace projects a fill only with enough history in the current window', () => {
  const resetsAt = '2026-10-02T12:00:00Z'
  const t0 = Date.parse('2026-10-02T08:00:00Z')
  const s = (min: number, pct: number, r = resetsAt) => ({ kind: 'five_hour', at: t0 + min * 60_000, pct, resetsAt: r })
  expect(pace([s(0, 10), s(5, 20)], 'five_hour', t0 + 5 * 60_000).kind).toBe('measuring')
  const fast = pace([s(0, 10), s(30, 40)], 'five_hour', t0 + 30 * 60_000)
  expect(fast).toEqual({ kind: 'full', inMs: 60 * 60_000 })
  expect(pace([s(0, 10), s(60, 12)], 'five_hour', t0 + 60 * 60_000).kind).toBe('fine')
  expect(pace([s(0, 90, 'old'), s(30, 5)], 'five_hour', t0 + 30 * 60_000).kind).toBe('measuring')
})

test('tool targets, names and row fitting', () => {
  expect(target({ command: 'npm   test\n --watch' })).toBe('npm test --watch')
  expect(target({ file_path: '/a/b/register.tsx', old_string: 'x' })).toBe('register.tsx')
  expect(target({ todos: [] })).toBe('')
  expect(toolName('mcp__claude-in-chrome__navigate')).toBe('navigate')
  expect(fit([{ t: 'abcdef' }, { t: 'gh' }], 4)).toEqual([{ t: 'abc…' }])
  expect(fit([{ t: 'ab' }], 4)).toEqual([{ t: 'ab' }, { t: '  ' }])
})

test('heaviest groups MCP tools by server and keeps the top three', () => {
  const top = heaviest({
    memoryFiles: [{ path: '/Users/a/.claude/CLAUDE.md', type: 'User', tokens: 3000 }],
    mcpTools: [
      { name: 'a', serverName: 'chrome', tokens: 2500, isLoaded: true },
      { name: 'b', serverName: 'chrome', tokens: 2500, isLoaded: true },
      { name: 'c', serverName: 'docs', tokens: 9000, isLoaded: false },
    ],
    skills: { totalSkills: 1, includedSkills: 1, tokens: 9900, skillFrontmatter: [] },
    agents: [{ agentType: 'Plan', source: 'built-in', tokens: 200 }],
  })
  expect(top).toEqual([
    { name: 'Skills listing', tokens: 9900 },
    { name: 'chrome MCP', tokens: 5000 },
    { name: 'CLAUDE.md', tokens: 3000 },
  ])
})

test('prompt.submit attaches the note only on the turn a level is crossed', async ($, on) => {
  mock.clock(on)
  const held = new Map<string, unknown>()
  let version = 0
  on('state.get', (_$, e) => ({ value: { value: held.get(e.key), version } }))
  on('state.set', (_$, e) => {
    held.set(e.key, e.value)
    version += 1
    return { value: { isSet: true as const, version } }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  const measure = (fiveHour: number) =>
    $.session.measure({ context: { window: 200_000, percent: 20 }, rateLimits: [{ kind: 'five_hour', percentUsed: fiveHour }], changed: ['rateLimits'] })
  const submit = () => $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })

  await measure(50)
  await submit()
  await measure(85)
  await submit()
  await submit()

  expect(seen[0]).toBeUndefined()
  expect(seen[1]?.[0]).toContain('5-hour usage window is at 85%')
  expect(seen[2]).toBeUndefined()
})
