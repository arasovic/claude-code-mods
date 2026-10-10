import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { axis, breakdown, clock, laneCells, target } from '../hooks/register'

const span = (kind: 'model' | 'tool', name: string, start: number, end: number, ok?: boolean) => ({ id: `${name}${start}`, lane: 'main', kind, name, detail: '', start, end, ok })

test('lane cells: tools win over model, short calls still show, failures stand out', () => {
  const spans = [span('model', 'model', 0, 40), span('tool', 'Bash', 41, 42), span('tool', 'Read', 60, 80, false)]
  expect(laneCells(spans, 0, 100, 10, 100)).toEqual(['model', 'model', 'model', 'model', 'tool', 'idle', 'failed', 'failed', 'idle', 'idle'])
})

test('breakdown samples the oldest running tool, then model, then idle', () => {
  const spans = [span('model', 'model', 0, 50), span('tool', 'Bash', 50, 80), span('tool', 'Read', 60, 90)]
  const parts = breakdown(spans, 0, 100, 100, 100)
  expect(parts.map(p => [p.name, Math.round(p.pct)])).toEqual([
    ['model', 50],
    ['Bash', 30],
    ['Read', 10],
    ['idle', 10],
  ])
})

test('axis labels are round and fit the width', () => {
  expect(axis(134_000, 30)).toBe(`0${' '.repeat(12)}1m${' '.repeat(11)}2m`)
  expect(axis(9_000, 20)).toBe(`0${' '.repeat(10)}5.0s`)
  // At 6 columns "5.0s" would start at column 3 and end past the edge, so it is dropped.
  expect(axis(9_000, 6)).toBe('0')
  expect(clock(1_234)).toBe('1.2s')
  expect(clock(90_000)).toBe('1m30s')
  expect(target({ command: 'npm  test' })).toBe('npm test')
})

const PANE = { title: 'Timeline', isFocused: false, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

// Beneath the plugin the test stands for the engine: a clock it moves by hand, tools that take 1.5s,
// and two general-purpose subagents. `loseClose` drops the write that would close the next tool's span,
// as when the mod's hooks worker ends mid-call.
const engine = (on: On) => {
  const clock = mock.clock(on, { now: 1_000 })
  const flags = { loseClose: false, dropWrite: false }
  on('state.set', (_$, e, next) => {
    if (!flags.dropWrite) return next(e)
    flags.dropWrite = false
    return { value: { isSet: true as const, version: (e.ifVersion ?? 0) + 1 } }
  })
  on('agent.list', () => ({
    value: [
      { id: 'a1', type: 'general-purpose', description: 'look around', status: 'running' as const },
      { id: 'a2', type: 'general-purpose', description: 'look elsewhere', status: 'running' as const },
    ],
  }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', async () => {
    await clock.advance(1_500)
    flags.dropWrite = flags.loseClose
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  return { clock, flags }
}
const complete = ($: Engine) => $.turn.complete({ answer: 'ok', durationMs: 0, isAborted: false, reason: 'answer', turnId: 't' })
const draw = async ($: Engine, surface: 'terminal' | 'desktop') => {
  const ui = await $.ui.mount({ plugin: 'turn-timeline', surface, component: 'Pane', props: PANE, requestId: 'timeline' })
  const texts = (await ui.findAll({ type: 'Text' })).map(r => r.text)
  await ui.unmount()
  return texts
}
// The glance row's state, as each surface draws it: whole on the terminal, its first part elsewhere.
const glance = async ($: Engine, surface: 'terminal' | 'desktop') => (await draw($, surface)).find(r => /^(Running|Last turn) /.test(r)) ?? ''

test('a turn that has just ended reads as over, not as running', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'hi', turnId: 't' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await complete($)
  // No time has passed since the turn ended.
  expect(await glance($, 'terminal')).toMatch(/^Last turn 1\.5s /)
  expect(await glance($, 'desktop')).toMatch(/^Last turn /)
})

test('a main-loop step whose close never landed ends with the main loop', async ($, on) => {
  const { clock, flags } = engine(on)
  await $.turn.start({ text: 'hi', turnId: 't' })
  flags.loseClose = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  flags.loseClose = false
  await clock.advance(2_000)
  await complete($)
  // Five seconds on, the turn still reads as over and its clock has stopped at its end.
  await clock.advance(5_000)
  expect(await glance($, 'terminal')).toMatch(/^Last turn 3\.5s /)
  expect(await glance($, 'desktop')).toMatch(/^Last turn /)
})

test('a long target is cut before its name and duration, and long names keep a blank cell and their number before their bars', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'hi', turnId: 't' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build -- --filter every-package-in-this-workspace --verbose --no-cache' })
  // WebSearch's input differs by account (some have `mode`), so the call is not held to one schema.
  await $.tool.call({ tool: 'WebSearch', query: 'claude code mods' } as never)
  await $.tool.call({ tool: 'mcp__github__create_pull_request', title: 'fix' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pwd', agentId: 'a2' } as never)
  await complete($)
  const rows = (await draw($, 'terminal')).filter(r => /^[╭│╰].*[╮│╯]$/.test(r))
  for (const r of rows) expect(r.length).toBe(PANE.bodyColumns - 1)
  expect(rows.find(r => r.includes('every-package'))).toMatch(/… 1\.5s  │$/)
  expect(rows.some(r => r.startsWith('│  general-… '))).toBe(true)
  expect(rows.some(r => r.startsWith('│  genera… 2 '))).toBe(true)
  expect(rows.some(r => r.startsWith('│  WebSearch █'))).toBe(true)
  expect(rows.some(r => r.startsWith('│  create_p… █'))).toBe(true)
  // Off the terminal the target is handed over whole for the surface to cut; the name and the duration never give way.
  const ui = await $.ui.mount({ plugin: 'turn-timeline', surface: 'desktop', component: 'Pane', props: PANE, requestId: 'timeline' })
  expect((await ui.findAll({ type: 'Text' })).some(r => r.text.endsWith('--verbose --no-cache'))).toBe(true)
  const kept = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexShrink === 0).map(b => b.text)
  await ui.unmount()
  // The glance row's duration and shares, and each frame's title, never give way either.
  expect(kept.slice(0, 4)).toEqual(['7.5s', '0%', '60%', '40%'])
  for (const title of ['Timeline', 'Where time went', 'Slowest']) expect(kept).toContain(title)
  expect(kept).toContain('Bash')
  expect(kept).toContain('  1.5s')
})
