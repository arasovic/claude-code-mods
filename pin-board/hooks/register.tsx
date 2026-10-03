import type { CommandRunResult, EngineInterface, Register } from 'claude-code'

export type Pin = { text: string; keep?: true }

export function parsePin(args: string): Pin | undefined {
  const words = args.split(/\s+/).filter(Boolean)
  const text = words.filter(w => w !== '--keep').join(' ')
  if (!text) return undefined
  return words.includes('--keep') ? { text, keep: true } : { text }
}

export const listText = (pins: readonly Pin[]) => pins.map((p, i) => `${i + 1}. ${p.text}${p.keep ? ' (kept)' : ''}`).join('\n')

export const bandText = (pins: readonly Pin[]) => `📌 ${pins.map((p, i) => `${i + 1} ${p.text}`).join(' · ')}`

export const counterText = (n: number) => `📌 ${n} ${n === 1 ? 'pin' : 'pins'}`

// Later /pin and /unpin notes in the conversation can be newer than this list: the system prompt is only rendered again at start, /compact and /clear.
export const section = (pins: readonly Pin[]) =>
  `The user pinned these standing notes. Follow them until the user unpins them. If a later /pin or /unpin message in the conversation disagrees with this list, the later message wins.\n${listText(pins)}`

// Pins live as long as the process, so they outlast /clear; --keep ones are also stored for the folder and come back on the next start.
let cwd = ''
let pins: Pin[] = []

async function save($: EngineInterface, next: Pin[]) {
  pins = next
  await $.store.set(cwd, pins.filter(p => p.keep))
  $.ui.invalidate('ui.render')
}

async function pin($: EngineInterface, args: string): Promise<CommandRunResult> {
  if (!args.trim()) return { text: pins.length ? listText(pins) : 'No pins. Add one with /pin <note> [--keep].' }
  const added = parsePin(args)
  if (!added) return { text: 'Usage: /pin <note> [--keep]' }
  await save($, [...pins, added])
  const n = pins.length
  return {
    text: `Pinned ${n}: ${added.text}${added.keep ? ' (kept)' : ''}`,
    context: [`The user pinned standing note ${n}: ${added.text}\nFollow it until the user unpins it.`],
  }
}

async function unpin($: EngineInterface, args: string): Promise<CommandRunResult> {
  const arg = args.trim()
  if (arg === 'all') {
    if (!pins.length) return { text: 'No pins.' }
    await save($, [])
    return { text: 'Unpinned all.', context: ['The user removed all pinned notes. Stop following them.'] }
  }
  const n = Number(arg)
  const gone = pins[n - 1]
  if (!Number.isInteger(n) || !gone) return { text: pins.length ? `Usage: /unpin <1-${pins.length}|all>\n${listText(pins)}` : 'No pins.' }
  await save($, pins.filter((_, i) => i !== n - 1))
  return {
    text: `Unpinned ${n}: ${gone.text}`,
    context: [`The user removed pinned note ${n}: ${gone.text}\nStop following it. The remaining pins are renumbered:\n${listText(pins) || '(none)'}`],
  }
}

export const register: Register = (on, options) => {
  const display = options.display === 'counter' ? 'counter' : 'band'

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    const stored = await $.store.get(cwd)
    pins = Array.isArray(stored) ? (stored as Pin[]) : []
    if (pins.length) $.ui.toast(`📌 ${pins.length} kept ${pins.length === 1 ? 'pin' : 'pins'} · /pin to list`, { timeoutMs: 6000 })
    await $.command.register({ name: 'pin', description: 'Pin a standing note the model keeps following; no note lists the pins', argumentHint: '[note] [--keep]' })
    await $.command.register({ name: 'unpin', description: 'Remove a pinned note', argumentHint: '<n|all>' })
    return next(e)
  })

  on('command.run', { command: 'pin' }, ($, e) => pin($, e.args))
  on('command.run', { command: 'unpin' }, ($, e) => unpin($, e.args))

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!pins.length) return result
    return { sections: [...result.sections, { id: 'pin-board:pins', text: section(pins), scope: 'session' }] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band is shared with other plugins: keep what they drew beneath, and take one row however many pins there are.
    const below = await next(e)
    if (display !== 'band' || e.props.hasSurvey || !pins.length) return below
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Text wrap="truncate-end">{bandText(pins)}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'SessionMode' }, ($, e, next) =>
    display === 'counter' && pins.length ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, counterText(pins.length)] } }) : next(e),
  )
}
