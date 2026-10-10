import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

test('checkReset takes an optional next for a compact and needs a full handoff for a clear, and clear only when allowed', () => {
  const handoff = 'Goal: ship the parser. Done: tokenizer and tests. Decisions: no new dependency. Files: src/parse.ts, tests/parse.test.ts. Next: wire the parser into the CLI and run the full test suite before the commit.'
  expect(checkReset({ mode: 'compact', next: ' run the tests ' }, 'compact')).toEqual({ mode: 'compact', next: 'run the tests' })
  expect(checkReset({ mode: 'compact' }, 'compact')).toEqual({ mode: 'compact' })
  expect(checkReset({ mode: 'compact', next: '  ' }, 'compact')).toEqual({ mode: 'compact' })
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

// The plugin's $.state, kept in memory for the hook tests.
const memoryState = (on: On) => {
  const held = new Map<string, unknown>()
  let version = 0
  on('state.get', (_$, e) => ({ value: { value: held.get(e.key), version } }))
  on('state.set', (_$, e) => {
    held.set(e.key, e.value)
    version += 1
    return { value: { isSet: true as const, version } }
  })
}

test('prompt.submit attaches the note only on the turn a level is crossed', async ($, on) => {
  mock.clock(on)
  memoryState(on)
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

// A session at 80% context whose engine calls the reset path makes are recorded.
const resetSession = (on: On) => {
  mock.clock(on)
  memoryState(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const tools: string[] = []
  on('tool.register', (_$, e) => (tools.push(e.name), { value: { tool: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 80 }, rateLimits: [] } }))
  const compacts: unknown[] = []
  on('session.compact', (_$, e) => (compacts.push(e.instructions), { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }))
  const submits: { text: string; context?: readonly string[] }[] = []
  on('prompt.submit', (_$, e) => (submits.push({ text: e.text, context: e.context }), { text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  return { tools, compacts, submits, toasts }
}

test('a compact with next submits it as the next prompt, and one without next waits for the user', { options: { contextAction: 'compact', autoOpen: false } }, async ($, on) => {
  const { tools, compacts, submits, toasts } = resetSession(on)
  const reset = async (input: Record<string, string>) => {
    await $.tool.call({ tool: 'mcp__session-meter__context_reset', ...input })
    await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, reason: 'answer', turnId: 't' })
  }

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  expect(tools).toEqual(['context_reset'])
  await reset({ mode: 'compact', next: 'run the tests' })
  expect(compacts).toEqual(['The work continues with: run the tests'])
  expect(submits.map(p => p.text)).toEqual(['session-meter compacted the conversation. Continue: run the tests'])

  await reset({ mode: 'compact' })
  expect(compacts).toEqual(['The work continues with: run the tests', undefined])
  expect(submits).toHaveLength(1)
  expect(toasts.at(-1)).toBe('session-meter: compacted; waiting for you')
})

test('a headless session gets no context_reset tool and the suggest note', { options: { contextAction: 'compact', autoOpen: false } }, async ($, on) => {
  const { tools, submits } = resetSession(on)

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })

  expect(tools).toEqual([])
  const text = submits[0]?.context?.join('\n') ?? ''
  expect(text).toContain('context window is 80% full')
  expect(text).toContain('suggest /compact')
  expect(text).not.toContain('context_reset')
})

const PANE = { title: 'Context', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const

test('off the terminal only names, targets and labels give way; numbers and titles stay whole', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-02T08:00:00Z') })
  const held: Record<string, unknown> = {
    breakdown: {
      percent: 42,
      tokens: 84_000,
      window: 200_000,
      threshold: 160_000,
      categories: [{ name: 'Messages and tool results of this session', tokens: 60_000, color: 'suggestion', kind: 'used' }],
      heaviest: [{ name: 'A memory file with a long name.md', tokens: 9_000 }],
    },
    reading: at(42, 30),
    tools: [{ id: 't1', name: 'Bash', target: 'npm run build -- --filter every-package-in-this-workspace --verbose', sub: false, at: 0, ms: 3_500, ok: true }],
    requests: [{ at: 0, agent: 'general-purpose', input: 50_000, cached: 40_000, output: 900, ms: 4_200, model: 'claude-a-model-name-long-enough-to-crowd-the-title' }],
  }
  on('state.get', (_$, e) => ({ value: { value: held[e.key], version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'session-meter', surface: 'desktop', component: 'Pane', props: PANE, requestId: 'ctx' })
  const texts = (await ui.findAll({ type: 'Text' })).map(r => r.text)
  const boxes = await ui.findAll({ type: 'Box' })
  const kept = boxes.filter(b => b.props.flexShrink === 0).map(b => b.text)
  const spacers = boxes.filter(b => b.props.flexGrow === 1 && !b.children.length)
  await ui.unmount()
  // A spacer never closes up, so a cut target keeps a gap before its time.
  expect(spacers.length).toBeGreaterThan(0)
  for (const b of spacers) expect(b.props.minWidth).toBe(1)
  // The long parts arrive whole for the surface to cut.
  for (const t of ['Messages and tool results of this session', 'npm run build -- --filter every-package-in-this-workspace --verbose', 'general-purpose', 'a-model-name-long-enough-to-crowd-the-title'])
    expect(texts).toContain(t)
  for (const t of ['Context', 'Limits', 'Tools', 'Requests', '84.0k', '42%', '60.0k', '160k', '9.0k', '30%', '✓', '3.5s']) expect(kept).toContain(t)
  // The pace line starts in the limit label's column, not after three spaces.
  expect(texts).toContain('measuring pace…')
  expect(texts.some(t => t.startsWith('   measuring'))).toBe(false)
})
