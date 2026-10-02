import { expect, test } from 'claude-code/testing'

import { addTurn, cachedDraw, extractMermaid, fitImage, keptFolders, pngSize, replaceTurn } from '../hooks/register'

const diagram = (turnId: string, title: string, png?: string) => ({ turnId, title, source: title, ...(png ? { png } : {}) })

test('a new turn goes after the history and the oldest drop past the cap', () => {
  const history = [diagram('t1', 'a'), diagram('t1', 'b'), diagram('t2', 'c')]
  expect(addTurn(history, [diagram('t3', 'd')]).map(d => d.title)).toEqual(['a', 'b', 'c', 'd'])
  expect(addTurn(history, [diagram('t3', 'd'), diagram('t3', 'e')], 3).map(d => d.title)).toEqual(['c', 'd', 'e'])
})

test('a source already drawn reuses its PNG, and its folder survives the sweep', () => {
  const history = [diagram('t1', 'a', '/tmp/show-me/t1/out-1.png'), { ...diagram('t2', 'b'), error: 'boom' }, diagram('t2', 'c')]
  expect(cachedDraw(history, 'a')?.png).toBe('/tmp/show-me/t1/out-1.png')
  expect(cachedDraw(history, 'b')).toBeUndefined()
  expect(cachedDraw(history, 'c')).toBeUndefined()
  // A turn that reused t1's PNG keeps t1's folder even after t1's own entry left the history.
  expect([...keptFolders([diagram('t3', 'a', '/tmp/show-me/t1/out-1.png')])].sort()).toEqual(['t1', 't3'])
})

test('a rendered turn replaces only its own placeholders, in order', () => {
  const history = [diagram('t1', 'a', '/a.png'), diagram('t2', 'b'), diagram('t2', 'c')]
  const drawn = [diagram('t2', 'b', '/b.png'), diagram('t2', 'c', '/c.png')]
  expect(replaceTurn(history, 't2', drawn).map(d => d.png)).toEqual(['/a.png', '/b.png', '/c.png'])
  // The cap dropped the turn's first diagram while it rendered: the rest still match up.
  expect(replaceTurn([diagram('t2', 'c')], 't2', drawn).map(d => d.png)).toEqual(['/c.png'])
})

test('every mermaid fence is extracted, other fences are not', () => {
  const answer = 'Intro\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\n```ts\nconst x = 1\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n'
  expect(extractMermaid(answer)).toEqual(['flowchart LR\n  a --> b', 'sequenceDiagram\n  A->>B: hi'])
  expect(extractMermaid('no diagrams here')).toEqual([])
})

test('the PNG size comes from the IHDR chunk', () => {
  const header = String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 2, 200, 0, 0, 0, 120)
  expect(pngSize(btoa(header))).toEqual({ width: 712, height: 120 })
})

test('the image keeps its aspect within the pane', () => {
  expect(fitImage(800, 200, 80, 40)).toEqual({ columns: 80, rows: 10 })
  expect(fitImage(200, 800, 80, 40)).toEqual({ columns: 20, rows: 40 })
  expect(fitImage(4000, 100, 300, 40).columns).toBe(255)
})
