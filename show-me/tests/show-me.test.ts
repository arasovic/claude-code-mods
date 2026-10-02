import { expect, test } from 'claude-code/testing'

import { extractMermaid, fitImage, pngSize } from '../hooks/register'

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
