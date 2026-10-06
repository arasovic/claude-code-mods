import type { Elements, EngineInterface, Register } from 'claude-code'

type Size = { width: number; height: number }
type Picture = { n: number; path: string; size: Size }

// Pasting an image raises no prompt.edit, so the draft is read on a timer.
const POLL_MS = 250
// The shape drawn when the header cannot be read: a file over $.fs.read's size cap.
const FALLBACK: Size = { width: 16, height: 10 }
// Each tile adds a border around the picture and a label under it.
const CHROME = { columns: 2, rows: 3 }

export const imageTags = (text: string) => [...new Set([...text.matchAll(/\[Image #(\d+)\]/g)].map(m => Number(m[1])))]

// Width and height from the PNG's IHDR chunk: bytes 16-23, big-endian.
export const pngSize = (base64: string): Size | undefined => {
  const bytes = Uint8Array.from(atob(base64.slice(0, 32)), c => c.charCodeAt(0))
  if (bytes.length < 24 || String.fromCharCode(...bytes.slice(1, 4)) !== 'PNG') return undefined
  const view = new DataView(bytes.buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

// The largest box of cells within columns × rows that keeps the picture's shape; a cell is about twice as tall as wide.
export const fit = ({ width, height }: Size, columns: number, rows: number) => {
  const clamp = (n: number) => Math.max(1, Math.min(255, Math.round(n)))
  const across = Math.min(columns, (rows * 2 * width) / height)
  return { columns: clamp(across), rows: clamp((across * height) / width / 2) }
}

let dir: string | undefined
const pictures = new Map<number, Picture>()
let draft: number[] = []
let polling = false

// Claude Code keeps each paste as <tmp>/<project>/<session>/images/<n>.png. The project folder is named
// after the directory the session started in, which the session's cwd may since have left: find it by the id.
async function imagesDir($: EngineInterface) {
  if (dir !== undefined) return dir
  const root = (await $.env.get('CLAUDE_CODE_TMPDIR')) ?? `/tmp/claude-${(await $.process.run(['id', '-u'])).stdout.trim()}`
  const id = await $.session.id()
  for (const project of await $.fs.list(root).catch(() => [])) {
    if (await $.fs.exists(`${root}/${project.name}/${id}/images`)) return (dir = `${root}/${project.name}/${id}/images`)
  }
  return undefined
}

async function picture($: EngineInterface, n: number): Promise<Picture | undefined> {
  if (pictures.has(n)) return pictures.get(n)
  const folder = await imagesDir($)
  const path = `${folder}/${n}.png`
  if (folder === undefined || !(await $.fs.exists(path))) return undefined
  const size = await $.fs.read(path, { as: 'bytes' }).then(b => pngSize(b.base64), () => FALLBACK)
  if (size === undefined) return undefined
  return pictures.set(n, { n, path, size }).get(n)
}

async function poll($: EngineInterface) {
  if (polling) return
  polling = true
  try {
    const tags = imageTags((await $.prompt.read()).text)
    if (tags.join() === draft.join()) return
    // A tag can show up before its file is written; it is looked for again on the next tick.
    const ready = (await Promise.all(tags.map(n => picture($, n)))).filter(p => p !== undefined).map(p => p.n)
    if (ready.join() === draft.join()) return
    draft = ready
    $.ui.invalidate('ui.render')
  } catch {
    // No prompt box (a dialog holds it, or the session is headless): nothing to show.
  } finally {
    polling = false
  }
}

// One row of tiles sharing `columns`, each picture at most `rows` tall.
function tiles({ Box, Image, Text }: Elements['terminal'], list: readonly Picture[], columns: number, rows: number) {
  const share = Math.floor((columns - (list.length - 1)) / list.length) - CHROME.columns
  return (
    <Box flexDirection="row" columnGap={1}>
      {list.map(p => (
        <Box key={`image-${p.n}`} flexDirection="column" alignItems="center" borderStyle="round" borderDimColor>
          {/* Tiles stretch to the row's tallest; a shorter picture sits in the middle, its label stays at the bottom. */}
          <Box flexDirection="column" flexGrow={1} justifyContent="center">
            <Image source={{ file: p.path, format: 'png' }} {...fit(p.size, Math.max(1, share), rows)} alt={`[Image #${p.n}]`} />
          </Box>
          <Text dimColor>#{p.n}</Text>
        </Box>
      ))}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => ($.clock.every(POLL_MS, () => poll($)), next(e)))

  on('session.end', async ($, e, next) => (pictures.clear(), (draft = []), (dir = undefined), next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const rows = Math.min(6, e.props.maxRows - CHROME.rows - 1)
    if (e.surface !== 'terminal' || e.props.hasSurvey || draft.length === 0 || rows < 1) return below
    const elements = $.ui.resolve(e as typeof e & { surface: 'terminal' })
    const list = draft.map(n => pictures.get(n)).filter(p => p !== undefined)
    return (
      <elements.Box flexDirection="column">
        {tiles(elements, list, e.props.bodyColumns, rows)}
        {below}
      </elements.Box>
    )
  })

  // Pictures stay under the prompt that sent them, larger than in the draft.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface !== 'terminal') return below
    const list = (await Promise.all(imageTags(e.props.text).map(n => picture($, n)))).filter(p => p !== undefined)
    if (list.length === 0) return below
    const elements = $.ui.resolve(e as typeof e & { surface: 'terminal' })
    const { columns = 80, rows = 24 } = e.viewport ?? {}
    return (
      <elements.Box flexDirection="column">
        {below}
        {tiles(elements, list, Math.min(120, columns - 4), Math.min(20, Math.floor(rows / 2)))}
      </elements.Box>
    )
  })
}
