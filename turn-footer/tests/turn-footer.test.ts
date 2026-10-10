import { expect, test } from 'claude-code/testing'

import { clock, summary, tokens } from '../hooks/register'

test('duration and token formats', () => {
  expect(clock(3_400)).toBe('3s')
  expect(clock(64_000)).toBe('1m 4s')
  expect(clock(3_900_000)).toBe('1h 5m')
  expect(tokens(82_400)).toBe('82.4k')
  expect(tokens(950)).toBe('950')
})

test('summary skips empty parts and flags failures and a cold cache', () => {
  const s = { tools: 1, failed: 1, requests: 3, agents: ['a1', 'a2'], input: 100_000, cached: 10_000, output: 4_000 }
  expect(summary(s).map(p => p.t)).toEqual(['1 tool', '1 failed', '2 agents', '3 requests', '100k in  4.0k out', 'cache 10%'])
  expect(summary(s).find(p => p.t === 'cache 10%')?.c).toBe('error')
  expect(summary({ tools: 0, failed: 0, requests: 1, agents: [], input: 1000, cached: 960, output: 20 }).map(p => p.t)).toEqual(['1 request', '1.0k in  20 out', 'cache 96%'])
})

test('the summary line is indented by padding, which every surface draws two cells wide', async ($, on) => {
  const stats = { tools: 1, failed: 0, requests: 2, agents: [], input: 10_000, cached: 9_000, output: 500 }
  // Beneath the plugin the test stands for the engine's own line.
  on('ui.render', { component: 'TurnDuration' }, () => ({ type: 'Text', children: ['Baked for 4s'] }))
  on('state.get', { plugin: 'turn-footer', key: 'done' }, async () => ({ value: { value: [{ durationMs: 4_000, stats }], version: 1 } }))
  const ui = await $.ui.mount({ plugin: 'turn-footer', surface: 'desktop', component: 'TurnDuration', props: { word: 'Baked', durationMs: 4_000 } })
  const texts = (await ui.findAll({ type: 'Text' })).map(r => r.text)
  const pad = (await ui.findAll({ type: 'Box' })).find(b => b.props.paddingLeft === 2)
  await ui.unmount()
  expect(pad?.text).toContain('1 tool')
  expect(texts.some(t => /^ +$/.test(t))).toBe(false)
})
