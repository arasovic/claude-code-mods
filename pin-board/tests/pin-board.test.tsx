import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { parsePin } from '../hooks/register'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] }

// What sits beneath the plugin: the engine's commands, prompt, an empty band and the mode labels as one line.
function engine(on: Parameters<TestBody>[1]) {
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'intro', scope: 'shared' as const }] }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{['focus', ...e.props.modes].join(' & ')}</Text>
  })
}

async function start(...[$, on]: Parameters<TestBody>) {
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  engine(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const run = async (command: string, args: string) => $.command.run({ ...RUN, command, args })
  const list = async () => (await run('pin', '')).text
  const compose = async () => (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'pin-board:pins')?.text
  const band = async () => {
    const ui = await $.ui.mount({ plugin: 'pin-board', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND })
    const texts = (await ui.findAll({ type: 'Text', text: /📌/ })).map(t => t.text)
    await ui.unmount()
    return texts
  }
  const modes = async () => {
    const ui = await $.ui.mount({ plugin: 'pin-board', surface: 'terminal', component: 'SessionMode', requestId: 'modes', props: { modes: [] } })
    const text = (await ui.find({ type: 'Text' }))?.text
    await ui.unmount()
    return text
  }
  return { toasts, run, list, compose, band, modes }
}

test('--keep is a flag anywhere in the note, not part of its text', () => {
  expect(parsePin('use pnpm')).toEqual({ text: 'use pnpm' })
  expect(parsePin('--keep  use pnpm')).toEqual({ text: 'use pnpm', keep: true })
  expect(parsePin('see --keeper')).toEqual({ text: 'see --keeper' })
  expect(parsePin('  --keep ')).toBeUndefined()
})

test('a pin reaches the model at once and the system prompt; the band shows all pins in one row', async ($, on) => {
  const s = await start($, on)
  expect(await s.compose()).toBeUndefined()

  const r = await s.run('pin', 'use pnpm')
  expect(r.text).toBe('Pinned 1: use pnpm')
  expect(r.context?.[0]).toContain('standing note 1: use pnpm')
  await s.run('pin', 'no force push')
  expect(await s.compose()).toContain('1. use pnpm\n2. no force push')
  expect(await s.band()).toEqual(['📌 1 use pnpm · 2 no force push'])
  expect(await s.modes()).toBe('focus')
})

test('counter mode shows the number beside the mode labels instead of the band', { options: { display: 'counter' } }, async ($, on) => {
  const s = await start($, on)
  await s.run('pin', 'a')
  expect(await s.modes()).toBe('focus & 📌 1 pin')
  await s.run('pin', 'b')
  expect(await s.modes()).toBe('focus & 📌 2 pins')
  expect(await s.band()).toEqual([])
})

test('unpin renumbers, tells the model and empties the section', async ($, on) => {
  const s = await start($, on)
  await s.run('pin', 'a')
  await s.run('pin', 'b')
  const r = await s.run('unpin', '1')
  expect(r.text).toBe('Unpinned 1: a')
  expect(r.context?.[0]).toContain('1. b')
  expect((await s.run('unpin', '5')).text).toContain('Usage: /unpin <1-1|all>')
  expect((await s.run('unpin', 'all')).text).toBe('Unpinned all.')
  expect(await s.compose()).toBeUndefined()
  expect(await s.band()).toEqual([])
})

test('only --keep pins come back on the next start, with a toast', async ($, on) => {
  const s = await start($, on)
  await s.run('pin', 'for now')
  await s.run('pin', 'use pnpm --keep')
  expect(await s.list()).toBe('1. for now\n2. use pnpm (kept)')

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  expect(await s.list()).toBe('1. use pnpm (kept)')
  expect(await s.compose()).toContain('1. use pnpm (kept)')
  expect(s.toasts).toEqual(['📌 1 kept pin · /pin to list'])

  await $.session.start({ cwd: '/other', surface: 'terminal', isInteractive: true })
  expect(await s.list()).toContain('No pins.')
})
