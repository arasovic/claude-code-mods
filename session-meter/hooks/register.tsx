import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

import type { MeterBreakdown, MeterItem, MeterNote, MeterReading, MeterRequest, MeterSample, MeterTool } from '../types'

const PANE = 'ctx'
// A level fires again only once its figure has fallen this far below it: a window reset or a /compact.
const REARM = 10
// Pace needs this much history in the current window before it projects anything.
const PACE_MIN_MS = 10 * 60_000
const EIGHTHS = ' ▏▎▍▌▋▊▉'
const KEEP = 30

const LEVELS = [
  { id: 'five_hour:80', kind: 'five_hour', at: 80 },
  { id: 'seven_day:80', kind: 'seven_day', at: 80 },
  { id: 'seven_day:90', kind: 'seven_day', at: 90 },
  { id: 'context:60', kind: 'context', at: 60 },
]
type Level = (typeof LEVELS)[number]
const WINDOWS = [
  { kind: 'five_hour', label: '5h' },
  { kind: 'seven_day', label: '7d' },
]

const reading = atom({ plugin: 'session-meter', key: 'reading' } as const, { context: null, limits: [] } as MeterReading)
const fired = atom({ plugin: 'session-meter', key: 'fired' } as const, [] as string[])
const breakdown = atom({ plugin: 'session-meter', key: 'breakdown' } as const, null as MeterBreakdown | null)
const history = atom({ plugin: 'session-meter', key: 'history' } as const, [] as number[])
const samples = atom({ plugin: 'session-meter', key: 'samples' } as const, [] as MeterSample[])
const notes = atom({ plugin: 'session-meter', key: 'notes' } as const, [] as MeterNote[])
const tools = atom({ plugin: 'session-meter', key: 'tools' } as const, [] as MeterTool[])
const requests = atom({ plugin: 'session-meter', key: 'requests' } as const, [] as MeterRequest[])

// Subagent ids never change type, so one lookup per id is enough.
const agentTypes = new Map<string, string>()

const valueOf = (r: MeterReading, kind: string) =>
  kind === 'context' ? (r.context ?? undefined) : r.limits.find(l => l.kind === kind)?.percentUsed

export const cross = (r: MeterReading, firedIds: readonly string[]) => {
  const kept = firedIds.filter(id => {
    const level = LEVELS.find(l => l.id === id)
    const value = level && valueOf(r, level.kind)
    return level !== undefined && (value === undefined || value >= level.at - REARM)
  })
  const fresh = LEVELS.filter(l => !kept.includes(l.id) && (valueOf(r, l.kind) ?? 0) >= l.at)
  return { fired: [...kept, ...fresh.map(l => l.id)], fresh }
}

export const duration = (ms: number) => {
  const min = Math.max(0, Math.floor(ms / 60_000))
  if (min >= 1440) return `${Math.floor(min / 1440)}d${Math.floor((min % 1440) / 60)}h`
  if (min >= 60) return `${Math.floor(min / 60)}h${min % 60}m`
  return `${min}m`
}

export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return ms < 60_000 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : `${Math.floor(s / 60)}m${s % 60}s`
}

const resetsIn = (resetsAt: string | undefined, now: number) => (resetsAt ? Date.parse(resetsAt) - now : 0)

export const note = (r: MeterReading, fresh: readonly Level[], now: number) => {
  const kinds = [...new Set(fresh.map(l => l.kind))]
  const lines = kinds.map(kind => {
    const pct = Math.round(valueOf(r, kind) ?? 0)
    const resets = duration(resetsIn(r.limits.find(l => l.kind === kind)?.resetsAt, now))
    if (kind === 'five_hour')
      return `- The 5-hour usage window is at ${pct}% (resets in ${resets}). Tell the user in one short line. Do not stop or slow down: the session continues automatically at the usage limit, so hitting it only pauses work until the reset.`
    if (kind === 'seven_day')
      return `- The 7-day usage window is at ${pct}% (resets in ${resets}). Warn the user clearly: if it runs out, work stops and does NOT resume on its own when the reset is over 24 hours away. Before starting any large new task, ask the user whether to proceed.`
    return `- The context window is ${pct}% full. From now on, when a request starts new work: if it continues the current work, suggest /compact at a natural break; if it is unrelated and needs nothing from this conversation, suggest a fresh session (/clear or a new terminal); if it is new but needs a few facts from here, suggest a short handoff and then a fresh session. If the current request already starts new work, apply this now. Suggest it once; the user decides.`
  })
  return ['session-meter: an automatic note the user does not see. Mention it once; do not repeat it in later replies.', ...lines].join('\n')
}

const noteLabel = (fresh: readonly Level[]) => {
  const top = new Map(fresh.map(l => [l.kind, l.at]))
  const name: Record<string, string> = { five_hour: '5h window', seven_day: '7d window', context: 'context' }
  return [...top].map(([kind, at]) => `${name[kind]} crossed ${at}%`).join(', ')
}

// Projects when a window fills, from the samples taken since its last reset; idle time counts, so it errs late, not early.
export const pace = (list: readonly MeterSample[], kind: string, now: number) => {
  const mine = list.filter(s => s.kind === kind)
  const last = mine.at(-1)
  if (!last) return { kind: 'measuring' as const }
  const first = mine.find(s => s.resetsAt === last.resetsAt)
  if (!first || now - first.at < PACE_MIN_MS || last.pct <= first.pct) return { kind: 'measuring' as const }
  const perMs = (last.pct - first.pct) / (now - first.at)
  const fullIn = (100 - last.pct) / perMs
  const resets = resetsIn(last.resetsAt, now)
  return fullIn < resets ? { kind: 'full' as const, inMs: fullIn } : { kind: 'fine' as const }
}

// A bar chart in braille, two values per cell and four dots of height per row, bottom row first in the dot math.
export const braille = (values: readonly number[], max: number, cols: number, rows: number) => {
  const LEFT = [0x40, 0x04, 0x02, 0x01]
  const RIGHT = [0x80, 0x20, 0x10, 0x08]
  const heights = values.slice(-cols * 2).map(v => Math.round((Math.min(v, max) / Math.max(1, max)) * rows * 4))
  if (heights.length % 2) heights.unshift(0)
  return Array.from({ length: rows }, (_, r) => {
    const floor = (rows - 1 - r) * 4
    let line = ''
    for (let i = 0; i < heights.length; i += 2) {
      const dots = (h: number, bits: number[]) => bits.slice(0, Math.max(0, Math.min(4, h - floor))).reduce((a, b) => a | b, 0)
      line += String.fromCharCode(0x2800 + dots(heights[i] ?? 0, LEFT) + dots(heights[i + 1] ?? 0, RIGHT))
    }
    return line
  })
}

export const cells = (part: number, whole: number, width: number) => (whole > 0 ? Math.round((part / whole) * width) : 0)

export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))

export const heaviest = (b: Pick<SessionContextBreakdown, 'memoryFiles' | 'mcpTools' | 'skills' | 'slashCommands' | 'agents'>) => {
  const servers = new Map<string, number>()
  for (const t of b.mcpTools) if (t.isLoaded) servers.set(t.serverName, (servers.get(t.serverName) ?? 0) + t.tokens)
  const items: MeterItem[] = [
    ...b.memoryFiles.map(f => ({ name: f.path.split('/').pop() ?? f.path, tokens: f.tokens })),
    ...[...servers].map(([name, n]) => ({ name: `${name} MCP`, tokens: n })),
    ...(b.skills ? [{ name: 'Skills listing', tokens: b.skills.tokens }] : []),
    ...(b.slashCommands ? [{ name: 'Slash commands', tokens: b.slashCommands.tokens }] : []),
    ...b.agents.map(a => ({ name: `${a.agentType} agent`, tokens: a.tokens })),
  ]
  return items.sort((x, y) => y.tokens - x.tokens).slice(0, 3)
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

export const toolName = (tool: string) => (tool.startsWith('mcp__') ? (tool.split('__').at(-1) ?? tool) : tool)

// Rows are runs of styled text, so their width is known before drawing: frames pad and cut them exactly.
export type Seg = { t: string; c?: string; d?: boolean; b?: boolean }
type Row = Seg[]

const width = (row: Row) => row.reduce((n, s) => n + s.t.length, 0)

export const fit = (row: Row, w: number): Row => {
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

const zone = (pct: number) => (pct >= 80 ? 'error' : pct >= 60 ? 'warning' : 'success')

// A meter with eighth-cell precision; filled cells take the colour of the zone they sit in, so the bar warms as it fills.
export const meter = (pct: number, w: number): Row => {
  const eighths = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w * 8)
  const out: Row = []
  for (let i = 0; i < w; i++) {
    const left = eighths - i * 8
    const ch = left >= 8 ? '█' : left > 0 ? (EIGHTHS[left] ?? ' ') : '·'
    const seg = left > 0 ? { t: ch, c: zone(((i + 1) / w) * 100) } : { t: ch, d: true }
    const prev = out.at(-1)
    if (prev && prev.c === seg.c && prev.d === seg.d) prev.t += ch
    else out.push(seg)
  }
  return out
}

const refresh = async ($: EngineInterface) => {
  const { context, rateLimits } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  // The breakdown measures against the compaction window (CLAUDE_CODE_AUTO_COMPACT_WINDOW when set); `context.percent` uses the model's full window.
  await update($, reading, () => ({ context: b?.percentage ?? context.percent ?? null, limits: [...rateLimits] }))
  if (!b) return
  await update($, breakdown, () => ({
    percent: b.percentage,
    tokens: b.totalTokens,
    window: b.rawMaxTokens,
    threshold: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
    categories: b.categories.filter(c => !c.isDeferred).map(c => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
    heaviest: heaviest(b),
  }))
}

const sample = async ($: EngineInterface, limits: MeterReading['limits']) => {
  const at = await $.clock.now()
  await update($, samples, list => [...list, ...limits.map(l => ({ kind: l.kind, at, pct: l.percentUsed, resetsAt: l.resetsAt }))].slice(-200))
}

const agentLabel = async ($: EngineInterface, id: string | undefined) => {
  if (!id) return 'main'
  if (!agentTypes.has(id)) {
    const found = (await $.agent.list()).find(a => a.id === id)
    // The engine's own forks (compaction, memory) carry ids no list names.
    if (found) agentTypes.set(id, found.type)
    else return 'fork'
  }
  return agentTypes.get(id) ?? 'fork'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ctx', description: 'Show what fills the context window and how fast limits run down' })
    await refresh($)
    await sample($, (await read($, reading)).limits)
    void $.ui.open({ id: PANE, title: 'Session' })
    return next(e)
  })

  on('command.run', { command: 'ctx' }, async $ => {
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'Session' })
    return { text: opened.isPlaced ? 'Session pane opened.' : `Session pane is waiting: ${opened.reason}` }
  })

  on('session.measure', async ($, e, next) => {
    await update($, reading, r => ({ context: r.context, limits: [...e.rateLimits] }))
    if (e.changed.includes('rateLimits')) await sample($, e.rateLimits)
    if (e.changed.includes('context')) {
      if (e.context.tokens !== undefined) await update($, history, list => [...list, e.context.tokens ?? 0].slice(-120))
      await refresh($)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const r = await read($, reading)
    const crossed = cross(r, await read($, fired))
    await update($, fired, () => crossed.fired)
    if (crossed.fresh.length === 0) return next(e)
    const now = await $.clock.now()
    await update($, notes, list => [...list, { at: now, text: noteLabel(crossed.fresh) }].slice(-5))
    return next({ ...e, context: [...(e.context ?? []), note(r, crossed.fresh, now)] })
  })

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const id = e.tool_use_id ?? `${e.tool}:${at}`
    const entry: MeterTool = { id, name: toolName(e.tool), target: target(e as unknown as Record<string, unknown>), sub: e.agentId !== undefined, at }
    await update($, tools, list => [entry, ...list.filter(t => t.id !== id)].slice(0, KEEP))
    let ok = false
    try {
      const result = await next(e)
      ok = result.deny === undefined && !result.isError
      return result
    } finally {
      const ms = (await $.clock.now()) - at
      await update($, tools, list => list.map(t => (t.id === id ? { ...t, ms, ok } : t)))
    }
  })

  on('turn.step', async function* ($, e, next) {
    const at = await $.clock.now()
    const result = yield* next(e)
    const usage = result.usage
    if (usage) {
      try {
        const ms = (await $.clock.now()) - at
        const agent = await agentLabel($, e.agentId)
        const input = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
        const row = { at, agent, input, cached: usage.cache_read_input_tokens, output: usage.output_tokens, ms, model: usage.model }
        await update($, requests, list => [row, ...list].slice(0, KEEP))
      } catch {
        // The log is a convenience: a failed write must never break the model's response.
      }
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const b = await read($, breakdown)
    const r = await read($, reading)
    const turns = await read($, history)
    const list = await read($, samples)
    const sent = await read($, notes)
    const calls = await read($, tools)
    const asks = await read($, requests)
    const now = await $.clock.now()
    const w = Math.max(28, e.props.bodyColumns - 1)
    const inner = w - 6
    if (!b) return <Text dimColor>Waiting for the first context reading.</Text>

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

    // Context: one stacked bar of what fills it, the compaction mark, a legend, the size over turns, the heaviest items.
    const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0)
    const bar: Row = used.map(c => ({ t: '█'.repeat(cells(c.tokens, b.window, inner)), c: c.color }))
    const filled = width(bar)
    const mark = b.threshold === undefined ? -1 : Math.min(inner - 1, cells(b.threshold, b.window, inner))
    for (let i = filled; i < inner; i++) bar.push(i === mark ? { t: '┊', c: 'warning' } : { t: '·', d: true, c: mark >= 0 && i > mark ? 'error' : undefined })
    // The legend is a two-column grid, names left and counts right-aligned in each column.
    const colW = Math.floor((inner - 3) / 2)
    const keys = [
      ...used.map(c => ({ mark: '■', c: c.color, name: c.name, n: tokens(c.tokens) })),
      ...(b.threshold === undefined ? [] : [{ mark: '┊', c: 'warning', name: 'compacts at', n: tokens(b.threshold) }]),
    ]
    const key = (k: (typeof keys)[number]): Row => spread([{ t: `${k.mark} `, c: k.c }, { t: k.name.slice(0, colW - k.n.length - 3) }], [{ t: k.n, d: true }], colW)
    const legend: Row[] = []
    for (let i = 0; i < keys.length; i += 2) {
      const [a, z] = [keys[i], keys[i + 1]]
      if (a) legend.push([...key(a), ...(z ? [{ t: '   ' }, ...key(z)] : [])])
    }
    const last = turns.at(-1)
    const prev = turns.at(-2)
    const delta = last !== undefined && prev !== undefined ? last - prev : undefined
    const chartCols = inner - 12
    const chart = turns.length < 2 ? [] : braille(turns, b.window, chartCols, 2)
    const contextRows: Row[] = [
      spread([{ t: tokens(b.tokens), b: true }, { t: ` of ${tokens(b.window)}`, d: true }], [{ t: `${Math.round(b.percent)}%`, c: zone(b.percent), b: true }], inner),
      [],
      bar,
      [],
      ...legend,
      [],
      ...(chart.length
        ? [
            [{ t: chart[0] ?? '', c: 'suggestion' }, { t: '  ' }, { t: `${delta !== undefined && delta >= 0 ? '+' : '-'}${tokens(Math.abs(delta ?? 0))}`, b: true }],
            [{ t: chart[1] ?? '', c: 'suggestion' }, { t: '  last turn', d: true }],
          ]
        : [[{ t: 'Size over turns shows after two turns.', d: true }]]),
      ...(b.heaviest.length ? [[] as Row, ...b.heaviest.map(item => spread([{ t: '▸ ', d: true }, { t: item.name }], [{ t: tokens(item.tokens), d: true }], inner))] : []),
    ]

    // Limits: each window's meter, its reset, and whether the current pace lasts until then.
    const limitRows: Row[] = []
    const tones: string[] = []
    const glance: Row = [{ t: 'ctx ', d: true }, { t: `${Math.round(b.percent)}%`, c: zone(b.percent), b: true }]
    for (const win of WINDOWS) {
      const limit = r.limits.find(l => l.kind === win.kind)
      if (!limit) continue
      const p = pace(list, win.kind, now)
      const tone = limit.percentUsed >= 80 || (p.kind === 'full' && p.inMs < 3_600_000) ? 'error' : p.kind === 'full' ? 'warning' : 'success'
      tones.push(tone)
      const pct = `${Math.round(limit.percentUsed)}%`.padStart(4)
      const reset = `↻${duration(resetsIn(limit.resetsAt, now))}`.padEnd(7)
      if (limitRows.length) limitRows.push([])
      limitRows.push([{ t: `${win.label} `, b: true }, { t: '▕', d: true }, ...meter(limit.percentUsed, inner - 18), { t: '▏', d: true }, { t: ` ${pct} `, c: tone, b: true }, { t: reset, d: true }])
      limitRows.push(
        p.kind === 'measuring'
          ? [{ t: '   measuring pace…', d: true }]
          : p.kind === 'full'
            ? [{ t: `   full in ~${duration(p.inMs)} at this pace`, c: tone }]
            : [{ t: '   lasts until the reset at this pace', d: true }],
      )
      glance.push({ t: `   ${win.label} `, d: true }, { t: `${Math.round(limit.percentUsed)}%`, c: tone, b: true })
    }
    const hhmm = (ms: number) => {
      const d = new Date(ms)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    if (sent.length) limitRows.push([], ...sent.map(n => [{ t: `${hhmm(n.at)} `, d: true }, { t: `note sent: ${n.text}` }]))
    const limitTone = tones.includes('error') ? 'error' : tones.includes('warning') ? 'warning' : 'success'

    // Tools and Requests share the rows left below; each keeps at least three.
    // The glance row, each frame's two borders and top margin, and the Requests column header.
    const fixed = 1 + (contextRows.length + 3) + (limitRows.length ? limitRows.length + 3 : 0) + 3 + 4
    const left = Math.max(6, e.props.scroll.bodyRows - fixed)
    const toolCount = Math.max(3, Math.ceil(left / 2))
    const askCount = Math.max(3, left - toolCount)

    const shown = [...calls.filter(t => t.ok === undefined), ...calls.filter(t => t.ok !== undefined)].slice(0, toolCount)
    const running = calls.filter(t => t.ok === undefined).length
    const toolRows: Row[] = shown.length
      ? shown.map(t => {
          const icon = t.ok === undefined ? { t: '◌', c: 'warning' } : t.ok ? { t: '✓', c: 'success' } : { t: '✗', c: 'error' }
          const time = t.ms === undefined ? '…' : elapsed(t.ms)
          return spread([icon, { t: ` ${(t.sub ? `↳${t.name}` : t.name).padEnd(7)} `, b: !t.sub, d: t.sub }, { t: t.target.slice(0, inner - 16), d: true }], [{ t: time, d: true }], inner)
        })
      : [[{ t: 'No tool calls yet.', d: true }]]
    const toolTone = shown.find(t => t.ok !== undefined)?.ok === false ? 'error' : 'success'

    const col = (agent: string, input: string, output: string, cache: string, time: string) => `${agent.padEnd(10).slice(0, 10)}${input.padStart(6)}${output.padStart(6)}${cache.padStart(7)}${time.padStart(7)}`
    const askRows: Row[] = asks.length
      ? [
          [{ t: col('loop', 'in', 'out', 'cache', 'time'), d: true }],
          ...asks.slice(0, askCount).map(q => {
            const hit = q.input ? Math.round((q.cached / q.input) * 100) : 0
            const cacheTone = hit < 20 ? 'error' : hit < 50 ? 'warning' : undefined
            return [
              { t: q.agent.padEnd(10).slice(0, 10), b: q.agent === 'main', d: q.agent !== 'main' },
              { t: tokens(q.input).padStart(6) + tokens(q.output).padStart(6) },
              { t: `${hit}%`.padStart(7), c: cacheTone, d: cacheTone === undefined },
              { t: elapsed(q.ms).padStart(7), d: true },
            ]
          }),
        ]
      : [[{ t: 'No model requests yet.', d: true }]]
    const lastHit = asks[0] && asks[0].input ? asks[0].cached / asks[0].input : 1
    const model = asks[0]?.model.replace(/^claude-/, '') ?? ''

    return (
      <Box flexDirection="column">
        <Text>
          {fit(glance, w - 3).map((s, j) => (
            <Text key={String(j)} color={s.c} dimColor={s.d} bold={s.b}>
              {s.t}
            </Text>
          ))}
        </Text>
        {frame('Context', zone(b.percent), contextRows)}
        {limitRows.length ? frame('Limits', limitTone, limitRows) : null}
        {frame('Tools', toolTone, toolRows, running ? `${running} running` : '')}
        {frame('Requests', lastHit < 0.5 ? 'warning' : 'success', askRows, model)}
      </Box>
    )
  })
}
