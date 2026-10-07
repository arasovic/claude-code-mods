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

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

// Width and height from the PNG's IHDR chunk: bytes 16-23, big-endian. Anything that is not a PNG gives undefined.
export const pngSize = (base64: string) => {
  const bytes = Uint8Array.from(atob(base64.slice(0, 32)), c => c.charCodeAt(0))
  if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return undefined
  const v = new DataView(bytes.buffer)
  return { width: v.getUint32(16), height: v.getUint32(20) }
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

const DAY = 24 * 60 * 60 * 1000
// ponytail: fixed history cap; make it a userConfig option if someone needs more.
const MAX_DIAGRAMS = 30

// A new turn's diagrams go after the history; the oldest drop past the cap.
export const addTurn = (list: Diagram[], added: Diagram[], max = MAX_DIAGRAMS) => [...list, ...added].slice(-max)

// A turn's rendered diagrams replace its placeholders by source, so one the cap dropped mid-render shifts nothing.
export const replaceTurn = (list: Diagram[], turnId: string, drawn: Diagram[]) =>
  list.map(d => (d.turnId === turnId ? (drawn.find(x => x.source === d.source) ?? d) : d))

// A source the history already drew reuses that PNG; only new sources go to mmdc.
export const cachedDraw = (list: Diagram[], source: string) => list.findLast(d => d.source === source && d.png && !d.error)

// The turn folders the history still points at: its own turns and the folders its cached PNGs live in.
export const keptFolders = (list: Diagram[]) => new Set(list.flatMap(d => [d.turnId, ...(d.png ? [d.png.split('/').slice(-2)[0]!] : [])]))

// Other sessions share this folder, so only turns older than a day go; a newer one may still be on screen.
// The history's own folders stay whatever their age.
const sweep = async ($: EngineInterface, root: string, keep: Set<string>) => {
  const entries = await $.fs.list(root).catch(() => [])
  const old = []
  for (const entry of entries) {
    if (entry.kind !== 'dir' || keep.has(entry.name)) continue
    const stat = await $.fs.stat(`${root}/${entry.name}`).catch(() => null)
    if (stat && Date.now() - stat.mtimeMs > DAY) old.push(`${root}/${entry.name}`)
  }
  if (old.length) await $.process.run(['rm', '-rf', ...old]).catch(() => {})
}

const render = async ($: EngineInterface, sources: string[], turnId: string) => {
  const root = `${((await $.env.get('TMPDIR')) ?? '/tmp/').replace(/\/?$/, '/')}show-me`
  await sweep($, root, keptFolders(await read($, diagrams)))
  const dir = `${root}/${turnId}`
  // mmdc renders every fence of a markdown file in one browser launch, as out-1.png, out-2.png, ...
  await $.fs.write(`${dir}/in.md`, sources.map(s => '```mermaid\n' + s + '\n```').join('\n\n'))
  // Use the installed Chrome when there is one, so mmdc needs no browser download of its own.
  const hasChrome = await $.fs.exists(CHROME)
  if (hasChrome) await $.fs.write(`${dir}/puppeteer.json`, JSON.stringify({ executablePath: CHROME, headless: 'shell' }))
  const run = await $.process
    .run(['mmdc', ...(hasChrome ? ['-p', `${dir}/puppeteer.json`] : []), '-i', `${dir}/in.md`, '-o', `${dir}/out.md`, '-e', 'png', '-t', 'dark', '-b', 'transparent', '-s', '2'], { timeoutMs: 120_000 })
    .catch(async (err: unknown) => {
      // A rejection means mmdc could not start or ran past the timeout; only a missing mmdc gets the install hint.
      const found = await $.process.run(['sh', '-c', 'command -v mmdc']).then(r => r.exitCode === 0, () => true)
      if (found) return { exitCode: 1, stderr: String(err) }
      const hint = `mmdc is not installed: ${hasChrome ? 'PUPPETEER_SKIP_DOWNLOAD=1 ' : ''}npm i -g @mermaid-js/mermaid-cli`
      $.ui.toast(`show-me: ${hint}`)
      return { exitCode: 127, stderr: hint }
    })
  const error = run.exitCode === 0 ? undefined : run.stderr.trim().split('\n')[0] || `mmdc exited ${run.exitCode}`
  return Promise.all(
    sources.map(async (source, i): Promise<Diagram> => {
      const title = titleOf(source)
      if (error) return { turnId, title, source, error }
      const png = `${dir}/out-${i + 1}.png`
      const bytes = await $.fs.read(png, { as: 'bytes' }).catch(() => null)
      const size = bytes && pngSize(bytes.base64)
      return size ? { turnId, title, source, png, ...size } : { turnId, title, source, error: `mmdc wrote no valid PNG at ${png}` }
    }),
  )
}

// Other surfaces have no Image, so the PNG goes inside an Svg, at half its pixels since mmdc draws at scale 2.
// Undefined while there is no PNG, or past the Svg's 131072-character cap.
export const svgOf = (d: Diagram, base64: string) => {
  if (!d.width || !d.height) return undefined
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width / 2}" height="${d.height / 2}" viewBox="0 0 ${d.width} ${d.height}"><image href="data:image/png;base64,${base64}" width="${d.width}" height="${d.height}"/></svg>`
  return svg.length <= 131072 ? svg : undefined
}

// No focus: a focused pane takes the arrows and the hotkey letters away from the prompt.
// The person clicks the pane (or ctrl+x tab) to use its keys.
const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Show me', closeOnEscape: true })

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
      const before = await read($, diagrams)
      const added = sources.map(source => ({ ...cachedDraw(before, source), turnId: e.turnId, title: titleOf(source), source }))
      const history = await update($, diagrams, list => addTurn(list, added))
      // The pane jumps to the turn's first diagram.
      await update($, index, () => Math.max(0, history.length - sources.length))
      const opened = await open($)
      if (!opened.isPlaced) $.ui.toast(`show-me: ${sources.length} diagram(s), /show-me to open`)
      const fresh = [...new Set(added.filter(d => !d.png).map(d => d.source))]
      if (fresh.length === 0) return
      const drawn = await render($, fresh, e.turnId)
      await update($, diagrams, list => replaceTurn(list, e.turnId, drawn))
    })
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const list = await read($, diagrams)
    const close = <Button key="close" plain hotkey="x" label="close" onPress={() => $.ui.close({ id: PANE })} />
    const isTerminal = e.surface === 'terminal'
    const hint = isTerminal && <Text dimColor>Click the pane or press ctrl+x tab to use its keys</Text>
    if (list.length === 0) return <Box flexDirection="column" paddingTop={1}><Box gap={1}><Text dimColor>No diagrams yet. Ask with /show-me.</Text>{close}</Box>{hint}</Box>
    const i = Math.min(await read($, index), list.length - 1)
    const d = list[i]!
    const turns = [...new Set(list.map(x => x.turnId))]
    const step = (by: number) => () => update($, index, n => (n + by + list.length) % list.length)
    const cols = Math.max(1, e.props.bodyColumns)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 5)

    let body
    if (!isTerminal) {
      const bytes = d.png && !d.error ? await $.fs.read(d.png, { as: 'bytes' }).catch(() => null) : null
      const svg = bytes && svgOf(d, bytes.base64)
      const { Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })
      // Without a picture the source goes out as a mermaid fence, which a surface may draw itself.
      body = svg ? <Svg source={svg} alt={d.title} /> : <Markdown text={'```mermaid\n' + d.source + '\n```'} />
    } else if (d.error) body = <Box flexDirection="column"><Text color="red">{d.error}</Text><Text dimColor>{d.source}</Text></Box>
    else if (!d.png || !d.width || !d.height) body = <Text dimColor>rendering…</Text>
    else {
      const { Image } = $.ui.resolve(e as typeof e & { surface: 'terminal' })
      body = <Image source={{ file: d.png, format: 'png' }} {...fitImage(d.width, d.height, cols, room)} alt={d.title} />
    }

    return (
      <Box flexDirection="column" paddingTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>{`${i + 1}/${list.length}`}</Text>
          <Text dimColor>{`turn ${turns.indexOf(d.turnId) + 1}/${turns.length}`}</Text>
          <Text>{d.title}</Text>
          <Button key="prev" plain hotkey="p" label="‹" onPress={step(-1)} />
          <Button key="next" plain hotkey="n" label="›" onPress={step(1)} />
          {d.png && <Button key="open" plain hotkey="o" label="open" onPress={() => void $.process.run(['open', d.png!])} />}
          {close}
        </Box>
        {hint}
        {body}
      </Box>
    )
  })
}
