import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TimelineSpan, TimelineTurn } from '../types'

const PANE = 'timeline'
const LABEL_W = 10
// Spans kept per turn; a long agentic turn keeps its latest ones.
const KEEP = 400

const turn = atom({ plugin: 'turn-timeline', key: 'turn' } as const, null as TimelineTurn | null)

// Subagent ids never change type, so one lookup per id is enough.
const agentTypes = new Map<string, string>()

export const clock = (ms: number) => {
  const s = Math.max(0, ms / 1000)
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const r = Math.round(s)
  return r % 60 ? `${Math.floor(r / 60)}m${r % 60}s` : `${r / 60}m`
}

// What a tool call is about, in a few words: the command, the file's name, the pattern, the URL.
export const target = (input: Record<string, unknown>) => {
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'description', 'query', 'prompt', 'skill']) {
    const value = input[key]
    if (typeof value !== 'string' || !value) continue
    const text = key === 'file_path' || key === 'path' ? (value.split('/').pop() ?? value) : value
    return text.replace(/\s+/g, ' ').trim()
  }
  return ''
}

const live = (s: TimelineSpan, now: number) => s.end ?? now

// One lane's cells: a tool call wins a cell over a model request, and any overlap counts, so a short call still shows.
export const laneCells = (spans: readonly TimelineSpan[], start: number, end: number, cols: number, now: number) => {
  const step = Math.max(1, end - start) / cols
  return Array.from({ length: cols }, (_, i) => {
    const t0 = start + i * step
    const t1 = t0 + step
    const hits = spans.filter(s => s.start < t1 && live(s, now) > t0)
    const tool = hits.find(s => s.kind === 'tool')
    if (tool) return tool.ok === false ? 'failed' : 'tool'
    return hits.length ? 'model' : 'idle'
  })
}

// Where the main loop's wall-clock went, sampled: at each instant the oldest running tool, else a model request, else idle.
export const breakdown = (spans: readonly TimelineSpan[], start: number, end: number, now: number, samples = 600) => {
  const totals = new Map<string, number>()
  const step = Math.max(1, end - start) / samples
  for (let i = 0; i < samples; i++) {
    const t = start + (i + 0.5) * step
    const running = spans.filter(s => s.start <= t && live(s, now) > t)
    const tool = running.filter(s => s.kind === 'tool').sort((a, b) => a.start - b.start)[0]
    const key = tool ? tool.name : running.length ? 'model' : 'idle'
    totals.set(key, (totals.get(key) ?? 0) + step)
  }
  return [...totals].map(([name, ms]) => ({ name, ms, pct: (ms / Math.max(1, end - start)) * 100 })).sort((a, b) => b.ms - a.ms)
}

// An axis row with a few round labels, each left-aligned at its column and never overlapping the last.
export const axis = (duration: number, cols: number) => {
  const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].map(s => s * 1000)
  const step = STEPS.find(s => duration / s <= 3) ?? 3_600_000
  let row = ''
  for (let t = 0; t <= duration; t += step) {
    const col = Math.round((t / Math.max(1, duration)) * (cols - 1))
    const label = t === 0 ? '0' : clock(t)
    if (col < row.length + 1 && row.length) continue
    if (col + label.length > cols) break
    row = row.padEnd(col) + label
  }
  return row
}

const agentLabel = async ($: EngineInterface, id: string) => {
  if (!agentTypes.has(id)) {
    const found = (await $.agent.list()).find(a => a.id === id)
    // The engine's own forks (compaction, memory) carry ids no list names.
    if (!found) return 'fork'
    agentTypes.set(id, found.type)
  }
  return agentTypes.get(id) ?? 'fork'
}

// Opens a span on its loop's lane, adding the lane on first sight; returns the span id to close it with.
const open = async ($: EngineInterface, agentId: string | undefined, kind: TimelineSpan['kind'], name: string, detail: string) => {
  const at = await $.clock.now()
  const lane = agentId ?? 'main'
  const label = agentId ? await agentLabel($, agentId) : 'main'
  const id = `${lane}:${kind}:${at}:${Math.random().toString(36).slice(2, 6)}`
  await update($, turn, t => {
    const base = t ?? { start: at, lanes: [{ id: 'main', label: 'main' }], spans: [] }
    const same = base.lanes.filter(l => l.label === label || l.label.startsWith(`${label} `)).length
    const lanes = base.lanes.some(l => l.id === lane) ? base.lanes : [...base.lanes, { id: lane, label: same ? `${label} ${same + 1}` : label }]
    return { ...base, lanes, spans: [...base.spans, { id, lane, kind, name, detail, start: at }].slice(-KEEP) }
  })
  return id
}

const close = async ($: EngineInterface, id: string, ok?: boolean) => {
  const end = await $.clock.now()
  await update($, turn, t => (t ? { ...t, spans: t.spans.map(s => (s.id === id ? { ...s, end, ok } : s)) } : t))
}

// Rows are runs of styled text, so their width is known before drawing: frames pad and cut them exactly.
type Seg = { t: string; c?: string; d?: boolean; b?: boolean }
type Row = Seg[]

const width = (row: Row) => row.reduce((n, s) => n + s.t.length, 0)

const fit = (row: Row, w: number): Row => {
  const out: Row = []
  let n = 0
  for (const s of row) {
    const room = w - n
    if (room <= 0) break
    if (s.t.length <= room) {
      out.push(s)
      n += s.t.length
    } else {
      out.push({ ...s, t: `${s.t.slice(0, room - 1)}…` })
      n = w
    }
  }
  if (n < w) out.push({ t: ' '.repeat(w - n) })
  return out
}

const spread = (left: Row, right: Row, w: number): Row => [...left, { t: ' '.repeat(Math.max(1, w - width(left) - width(right))) }, ...right]

const CELL: Record<ReturnType<typeof laneCells>[number], Seg> = {
  tool: { t: '█', c: 'success' },
  failed: { t: '█', c: 'error' },
  model: { t: '▒', c: 'suggestion' },
  idle: { t: '·', d: true },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'timeline', description: 'Show the current turn as a timeline of model requests and tool calls' })
    return next(e)
  })

  on('command.run', { command: 'timeline' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Timeline' })
    return { text: opened.isPlaced ? 'Timeline pane opened.' : `Timeline pane is waiting: ${opened.reason}` }
  })

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, turn, () => ({ start: at, lanes: [{ id: 'main', label: 'main' }], spans: [] }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, turn, t => (t ? { ...t, end: at } : t))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = await open($, e.agentId, 'tool', e.tool.startsWith('mcp__') ? (e.tool.split('__').at(-1) ?? e.tool) : e.tool, target(e as unknown as Record<string, unknown>))
    let ok = false
    try {
      const result = await next(e)
      ok = result.deny === undefined && !result.isError
      return result
    } finally {
      await close($, id, ok)
    }
  })

  on('turn.step', async function* ($, e, next) {
    let id: string | undefined
    try {
      id = await open($, e.agentId, 'model', 'model', '')
    } catch {
      // The timeline is a convenience: a failed write must never block the model's request.
    }
    try {
      return yield* next(e)
    } finally {
      if (id) await close($, id).catch(() => undefined)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, turn)
    const now = await $.clock.now()
    const w = Math.max(30, e.props.bodyColumns - 1)
    const inner = w - 6
    if (!t) return <Text dimColor>The timeline starts with the next turn.</Text>

    const frame = (title: string, tone: string, rows: Row[], right = '') => {
      const rule = Math.max(0, w - 6 - title.length - (right ? right.length + 2 : 0))
      return (
        <Box key={title} flexDirection="column" marginTop={1}>
          <Text>
            <Text color={tone} dimColor>╭─ </Text>
            <Text color={tone} bold>{title}</Text>
            <Text color={tone} dimColor> {'─'.repeat(rule)}</Text>
            {right ? <Text dimColor> {right} </Text> : null}
            <Text color={tone} dimColor>─╮</Text>
          </Text>
          {rows.map((row, i) => (
            <Text key={String(i)}>
              <Text color={tone} dimColor>│  </Text>
              {fit(row, inner).map((s, j) => (
                <Text key={String(j)} color={s.c} dimColor={s.d} bold={s.b}>
                  {s.t}
                </Text>
              ))}
              <Text color={tone} dimColor>  │</Text>
            </Text>
          ))}
          <Text color={tone} dimColor>╰{'─'.repeat(w - 2)}╯</Text>
        </Box>
      )
    }

    // A background subagent outlives the main turn, so the timeline runs until its last step ends too.
    const end = !t.end || t.spans.some(s => s.end === undefined) ? now : Math.max(t.end, ...t.spans.map(s => s.end ?? 0))
    const duration = end - t.start
    const cols = inner - LABEL_W
    const main = t.spans.filter(s => s.lane === 'main')
    const parts = breakdown(main, t.start, end, now)
    const pct = (name: string) => Math.round(parts.find(p => p.name === name)?.pct ?? 0)
    const toolPct = Math.max(0, 100 - pct('model') - pct('idle'))

    const glance: Row = [
      { t: t.end && end !== now ? 'Last turn ' : 'Running ', d: true },
      { t: clock(duration), b: true },
      { t: '   model ', d: true },
      { t: `${pct('model')}%`, c: 'suggestion', b: true },
      { t: '   tools ', d: true },
      { t: `${toolPct}%`, c: 'success', b: true },
      { t: '   idle ', d: true },
      { t: `${pct('idle')}%`, b: true },
    ]

    // One row per loop, the busiest first after main; lanes past the room left fold into a count.
    const maxLanes = Math.max(1, Math.floor((e.props.scroll.bodyRows - 20) / 2))
    const lanes = t.lanes.slice(0, maxLanes)
    const laneRows: Row[] = lanes.flatMap((lane, i) => {
      const cells = laneCells(
        t.spans.filter(s => s.lane === lane.id),
        t.start,
        end,
        cols,
        now,
      ).map(k => CELL[k])
      const row: Row = [{ t: lane.label.padEnd(LABEL_W).slice(0, LABEL_W), b: lane.id === 'main', d: lane.id !== 'main' }, ...cells]
      return i ? [[], row] : [row]
    })
    const hidden = t.lanes.length - lanes.length
    const timelineRows: Row[] = [
      ...laneRows,
      ...(hidden > 0 ? [[{ t: `+${hidden} more loops`, d: true }]] : []),
      [{ t: ' '.repeat(LABEL_W) }, { t: axis(duration, cols), d: true }],
      [],
      [{ t: '█', c: 'success' }, { t: ' tool   ', d: true }, { t: '▒', c: 'suggestion' }, { t: ' model   ', d: true }, { t: '█', c: 'error' }, { t: ' failed   ', d: true }, { t: '·', d: true }, { t: ' idle', d: true }],
    ]

    // Each share as a bar against the turn's length, model and idle named, tools by name.
    const barW = inner - 24
    const shareRows: Row[] = parts.slice(0, 6).map(p => {
      const filled = Math.round((p.pct / 100) * barW)
      const tone = p.name === 'model' ? 'suggestion' : p.name === 'idle' ? undefined : 'success'
      return spread(
        [{ t: p.name.padEnd(9).slice(0, 9), d: p.name === 'idle' }, { t: '█'.repeat(filled), c: tone, d: p.name === 'idle' }, { t: '·'.repeat(Math.max(0, barW - filled)), d: true }],
        [{ t: clock(p.ms).padStart(6), d: true }, { t: `${Math.round(p.pct)}%`.padStart(5), b: true }],
        inner,
      )
    })

    const slowest = t.spans
      .filter(s => s.end !== undefined)
      .sort((a, b) => (b.end ?? 0) - b.start - ((a.end ?? 0) - a.start))
      .slice(0, 3)
    // A model request has no target of its own, so it is named by its place in its loop: "request 3 of 5".
    const requestOf = (s: TimelineSpan) => {
      const mine = t.spans.filter(x => x.lane === s.lane && x.kind === 'model')
      return `request ${mine.indexOf(s) + 1} of ${mine.length}`
    }
    const slowRows: Row[] = slowest.length
      ? slowest.map(s =>
          spread(
            [
              { t: s.kind === 'model' ? 'model' : s.name, c: s.kind === 'model' ? 'suggestion' : s.ok === false ? 'error' : 'success', b: true },
              { t: `  ${s.lane === 'main' ? '' : `${t.lanes.find(l => l.id === s.lane)?.label ?? ''}  `}${s.kind === 'model' ? requestOf(s) : s.detail}`, d: true },
            ],
            [{ t: clock((s.end ?? now) - s.start), b: true }],
            inner,
          ),
        )
      : [[{ t: 'Nothing has finished yet.', d: true }]]

    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text>
          {fit(glance, w - 3).map((s, j) => (
            <Text key={String(j)} color={s.c} dimColor={s.d} bold={s.b}>
              {s.t}
            </Text>
          ))}
        </Text>
        {frame('Timeline', 'suggestion', timelineRows, `${t.lanes.length} ${t.lanes.length === 1 ? 'loop' : 'loops'}`)}
        {frame('Where time went', 'success', shareRows, 'main loop')}
        {frame('Slowest', 'warning', slowRows)}
      </Box>
    )
  })
}
