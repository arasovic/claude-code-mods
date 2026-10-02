import { expect, test } from 'claude-code/testing'

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
