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
