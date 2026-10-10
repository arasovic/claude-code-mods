import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Diagram } from '../types'

const PROPS = { title: 'Show me', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

// Error entries draw the same on every surface; a rendered PNG would need a file on disk.
const HISTORY: Diagram[] = [
  { turnId: 't1', title: 'flowchart LR', source: 'flowchart LR\n  a --> b', error: 'boom' },
  { turnId: 't1', title: 'sequenceDiagram', source: 'sequenceDiagram\n  A->>B: hi', error: 'boom' },
  { turnId: 't2', title: 'flowchart TD', source: 'flowchart TD\n  c --> d', error: 'boom' },
]

// Beneath the plugin the test stands for the engine: it answers the history read and records pane closes.
// The kit keeps every other value, so the index moves as in a session.
const engine = (on: On, history: Diagram[]) => {
  const closed: string[] = []
  on('state.get', { plugin: 'show-me', key: 'diagrams' }, async () => ({ value: { value: history, version: 1 } }))
  on('ui.close', async (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  return closed
}

for (const surface of ['terminal', 'desktop'] as const) {
  const mount = ($: Engine) => $.ui.mount({ plugin: 'show-me', surface, component: 'Pane', props: PROPS, requestId: 'show-me', viewport: { columns: 120, rows: 40 } })

  test(`${surface}: the empty pane says how to ask and can close`, async ($, on) => {
    engine(on, [])
    const ui = await mount($)
    expect((await ui.find({ text: /No diagrams yet/ }))?.text).toContain('/show-me')
    expect(await ui.find({ key: 'close' })).toBeDefined()
    expect(await ui.find({ key: 'next' })).toBeUndefined()
  })

  test(`${surface}: p and n step through the history across turns and wrap`, async ($, on) => {
    engine(on, HISTORY)
    const ui = await mount($)
    const header = async () => [(await ui.find({ type: 'Text', text: /^\d+\/3$/ }))?.text, (await ui.find({ type: 'Text', text: /^turn / }))?.text]
    expect(await header()).toEqual(['1/3', 'turn 1/2'])
    await ui.press({ key: 'next' })
    await ui.press({ key: 'next' })
    expect(await header()).toEqual(['3/3', 'turn 2/2'])
    await ui.press({ key: 'next' })
    expect(await header()).toEqual(['1/3', 'turn 1/2'])
    await ui.press({ key: 'prev' })
    expect(await header()).toEqual(['3/3', 'turn 2/2'])
  })

  if (surface === 'terminal')
    test(`${surface}: a failed render shows its error and source, with no open button`, async ($, on) => {
      engine(on, HISTORY.slice(0, 1))
      const ui = await mount($)
      expect(await ui.find({ text: 'boom' })).toBeDefined()
      expect(await ui.find({ text: /a --> b/ })).toBeDefined()
      expect(await ui.find({ key: 'open' })).toBeUndefined()
    })
  else
    test(`${surface}: the diagram is a mermaid fence the surface draws, whatever mmdc did`, async ($, on) => {
      engine(on, HISTORY.slice(0, 1))
      const ui = await mount($)
      expect((await ui.find({ type: 'Markdown' }))?.text).toBe('```mermaid\nflowchart LR\n  a --> b\n```')
      expect(await ui.find({ text: 'boom' })).toBeUndefined()
      expect(await ui.find({ text: /ctrl\+x tab/ })).toBeUndefined()
    })

  if (surface !== 'terminal')
    test(`${surface}: a rendered diagram is its PNG inside an Svg, at half its pixels`, async ($, on) => {
      engine(on, [{ turnId: 't1', title: 'flowchart LR', source: 'flowchart LR\n  a --> b', png: '/tmp/out-1.png', width: 200, height: 100 }])
      on('fs.read', async () => ({ value: { base64: 'iVBORw0KGgo=' } }))
      const ui = await mount($)
      const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(svg).toContain('width="100" height="50" viewBox="0 0 200 100"')
      expect(svg).toContain('href="data:image/png;base64,iVBORw0KGgo="')
      expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    })

  test(`${surface}: a long title gives way to the counters and the keys`, async ($, on) => {
    const title = 'flowchart LR with a title long enough to run past a narrow pane'
    engine(on, [{ turnId: 't1', title, source: 'flowchart LR\n  a --> b', error: 'boom' }])
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: title }))?.props.wrap).toBe('truncate-end')
    const kept = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexShrink === 0).map(b => b.text)
    expect(kept).toContain('1/1turn 1/1')
    expect(kept.some(t => t.includes('close'))).toBe(true)
  })

  test(`${surface}: x closes the pane`, async ($, on) => {
    const closed = engine(on, HISTORY)
    const ui = await mount($)
    await ui.press({ key: 'close' })
    expect(closed).toEqual(['show-me'])
  })
}
