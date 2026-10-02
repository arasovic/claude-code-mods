import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diagram } from '../types'

const PANE = 'show-me'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ASK = 'Answer with one or more mermaid diagrams in ```mermaid fences (prefer flowchart LR), each followed by a short explanation.'

const diagrams = atom({ plugin: 'show-me', key: 'diagrams' } as const, [] as Diagram[])
const index = atom({ plugin: 'show-me', key: 'index' } as const, 0)

export const extractMermaid = (text: string) => [...text.matchAll(/^```mermaid[^\n]*\n([\s\S]*?)^```/gm)].map(m => m[1]!.trim()).filter(Boolean)

const titleOf = (source: string) => source.split('\n').find(l => l.trim() && !l.trim().startsWith('%%'))?.trim() ?? 'diagram'

// Width and height from the PNG's IHDR chunk: bytes 16-23, big-endian.
export const pngSize = (base64: string) => {
  const b = atob(base64.slice(0, 32))
  const at = (i: number) => ((b.charCodeAt(i) << 24) | (b.charCodeAt(i + 1) << 16) | (b.charCodeAt(i + 2) << 8) | b.charCodeAt(i + 3)) >>> 0
  return { width: at(16), height: at(20) }
}

// A terminal cell is about twice as tall as it is wide.
export const fitImage = (width: number, height: number, maxCols: number, maxRows: number) => {
  const clamp = (n: number, hi: number) => Math.max(1, Math.min(hi, 255, Math.round(n)))
  let columns = maxCols
  let rows = (columns * height) / width / 2
  if (rows > maxRows) {
    rows = maxRows
    columns = (rows * 2 * width) / height
  }
  return { columns: clamp(columns, maxCols), rows: clamp(rows, maxRows) }
}

const render = async ($: EngineInterface, sources: string[], turnId: string) => {
  const dir = `${((await $.env.get('TMPDIR')) ?? '/tmp/').replace(/\/?$/, '/')}show-me/${turnId}`
  // mmdc renders every fence of a markdown file in one browser launch, as out-1.png, out-2.png, ...
  await $.fs.write(`${dir}/in.md`, sources.map(s => '```mermaid\n' + s + '\n```').join('\n\n'))
  // Use the installed Chrome when there is one, so mmdc needs no browser download of its own.
  const hasChrome = await $.fs.stat(CHROME).then(
    () => true,
    () => false,
  )
  if (hasChrome) await $.fs.write(`${dir}/puppeteer.json`, JSON.stringify({ executablePath: CHROME, headless: 'shell' }))
  const run = await $.process
    .run(['mmdc', ...(hasChrome ? ['-p', `${dir}/puppeteer.json`] : []), '-i', `${dir}/in.md`, '-o', `${dir}/out.md`, '-e', 'png', '-t', 'dark', '-b', 'transparent', '-s', '2'], { timeoutMs: 120_000 })
    .catch((err: unknown) => ({ exitCode: 1, stderr: String(err) }))
  const error = run.exitCode === 0 ? undefined : run.stderr.trim().split('\n')[0] || `mmdc exited ${run.exitCode}`
  return Promise.all(
    sources.map(async (source, i): Promise<Diagram> => {
      const title = titleOf(source)
      if (error) return { title, source, error }
      const png = `${dir}/out-${i + 1}.png`
      const read = await $.fs.read(png, { as: 'bytes' }).catch(() => null)
      return read ? { title, source, png, ...pngSize(read.base64) } : { title, source, error: `mmdc wrote no ${png}` }
    }),
  )
}

// The surface grants focus only over an idle, empty composer, so an open never takes keys mid-draft;
// when refused, closeOnEscape still lets Esc at the empty prompt close the pane.
const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Show me', closeOnEscape: true, focus: true })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'show-me', description: 'Ask for an answer as mermaid diagrams, or open the diagram pane', argumentHint: '[question]' })
    return next(e)
  })

  on('command.run', { command: 'show-me' }, async ($, e) => {
    const question = e.args.trim()
    if (question) {
      // The engine refuses a submit while command.run holds the turn, so it goes out once the command is done.
      $.clock.after(0, () =>
        $.prompt.submit({ text: `${question}\n\n${ASK}`, asUser: true }).catch((err: unknown) => $.ui.toast(`show-me: ${String(err)}`)),
      )
      return {}
    }
    const opened = await open($)
    return { text: opened.isPlaced ? 'Diagram pane opened.' : `Diagram pane is waiting: ${opened.reason}` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const sources = e.agentId || e.reason !== 'answer' ? [] : extractMermaid(e.answer)
    if (sources.length === 0) return result
    // Rendering launches a browser; it runs after the turn so the turn ends on time.
    $.clock.after(0, async () => {
      await update($, diagrams, () => sources.map(source => ({ title: titleOf(source), source })))
      await update($, index, () => 0)
      const opened = await open($)
      if (!opened.isPlaced) $.ui.toast(`show-me: ${sources.length} diagram(s), /show-me to open`)
      const drawn = await render($, sources, e.turnId)
      await update($, diagrams, () => drawn)
    })
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, diagrams)
    const close = <Button plain hotkey="x" label="close" onPress={() => $.ui.close({ id: PANE })} />
    if (list.length === 0) return <Box paddingTop={1} gap={1}><Text dimColor>No diagrams yet. Ask with /show-me.</Text>{close}</Box>
    const i = Math.min(await read($, index), list.length - 1)
    const d = list[i]!
    const step = (by: number) => () => update($, index, n => (n + by + list.length) % list.length)
    const cols = Math.max(1, e.props.bodyColumns)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)

    let body
    if (d.error) body = <Box flexDirection="column"><Text color="red">{d.error}</Text><Text dimColor>{d.source}</Text></Box>
    else if (!d.png || !d.width || !d.height) body = <Text dimColor>rendering…</Text>
    else if (e.surface === 'terminal') {
      const { Image } = $.ui.resolve(e as typeof e & { surface: 'terminal' })
      body = <Image source={{ file: d.png, format: 'png' }} {...fitImage(d.width, d.height, cols, room)} alt={d.title} />
    } else body = <Text dimColor>{d.source}</Text>

    return (
      <Box flexDirection="column" paddingTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>{`${i + 1}/${list.length}`}</Text>
          <Text>{d.title}</Text>
          <Button plain hotkey="p" label="‹" onPress={step(-1)} />
          <Button plain hotkey="n" label="›" onPress={step(1)} />
          {d.png && <Button plain hotkey="o" label="open" onPress={() => void $.process.run(['open', d.png!])} />}
          {close}
        </Box>
        {body}
      </Box>
    )
  })
}
