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

export const levels = (contextAt: number) => [
  { id: 'five_hour:80', kind: 'five_hour', at: 80 },
  { id: 'seven_day:80', kind: 'seven_day', at: 80 },
  { id: 'seven_day:90', kind: 'seven_day', at: 90 },
  { id: `context:${contextAt}`, kind: 'context', at: contextAt },
]
type Level = ReturnType<typeof levels>[number]
// The tool the model calls to compact or clear on its own; registered only when contextAction is not `suggest`.
const RESET = 'context_reset'
const RESET_TOOL = 'mcp__session-meter__context_reset'
// After a clear the model has only the handoff, so one shorter than this cannot carry the goal, state and next step.
const HANDOFF_MIN = 200
const ACTIONS = ['suggest', 'compact', 'compact-or-clear'] as const
export type ContextAction = (typeof ACTIONS)[number]

// A value outside the manifest's choices or range falls back to the default, so a typo can never turn the tool on.
export const readOptions = (options: Readonly<Record<string, unknown>>) => {
  const action = ACTIONS.find(a => a === options.contextAction) ?? 'suggest'
  const at = Number(options.contextAt)
  return { action, contextAt: Number.isFinite(at) && at >= 10 && at <= 95 ? at : 60 }
}

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

export const cross = (r: MeterReading, firedIds: readonly string[], list = levels(60)) => {
  const kept = firedIds.filter(id => {
    const level = list.find(l => l.id === id)
    const value = level && valueOf(r, level.kind)
    return level !== undefined && (value === undefined || value >= level.at - REARM)
  })
  const fresh = list.filter(l => !kept.includes(l.id) && (valueOf(r, l.kind) ?? 0) >= l.at)
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

export const note = (r: MeterReading, fresh: readonly Level[], now: number, action: ContextAction = 'suggest') => {
  const kinds = [...new Set(fresh.map(l => l.kind))]
  const lines = kinds.map(kind => {
    const pct = Math.round(valueOf(r, kind) ?? 0)
    const resets = duration(resetsIn(r.limits.find(l => l.kind === kind)?.resetsAt, now))
    if (kind === 'five_hour')
      return `- The 5-hour usage window is at ${pct}% (resets in ${resets}). Tell the user in one short line. Do not stop or slow down: the session continues automatically at the usage limit, so hitting it only pauses work until the reset.`
    if (kind === 'seven_day')
      return `- The 7-day usage window is at ${pct}% (resets in ${resets}). Warn the user clearly: if it runs out, work stops and does NOT resume on its own when the reset is over 24 hours away. Before starting any large new task, ask the user whether to proceed.`
    if (action !== 'suggest')
      return `- The context window is ${pct}% full. At the next natural break, call the ${RESET} tool yourself, as its description says. Do not ask the user first.`
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

// Rows are runs of styled text. The terminal draws them on a grid of cells, so frames pad and cut them exactly.
// Other surfaces draw text in a proportional font, where spaces line nothing up: there a row is a flex line.
// `fill` stretches, `w` is a column that many characters wide (`right` aligns it), a Bar draws `parts` as real
// bars in place of its `cells`, a Spark draws a bar per value, and a Group takes an equal share of the line.
export type Seg = { t: string; c?: string; d?: boolean; b?: boolean; fill?: boolean; w?: number; right?: boolean }
type Bar = { cells: Seg[]; parts: { n: number; c?: string }[] }
type Spark = { spark: readonly number[]; max: number; c: string }
type Group = { group: Row }
type Row = (Seg | Bar | Spark | Group)[]

// The empty part of a bar where the surface draws real bars.
const TRACK = 'userMessageBackgroundHover'

const segs = (row: Row): Seg[] => row.flatMap(s => ('t' in s ? [s] : 'cells' in s ? s.cells : 'group' in s ? segs(s.group) : []))

const width = (row: Row) => segs(row).reduce((n, s) => n + s.t.length, 0)

export const fit = (row: Row, w: number): Seg[] => {
  const out: Seg[] = []
  let n = 0
  for (const s of segs(row)) {
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

const spread = (left: Row, right: Row, w: number): Row => [...left, { t: ' '.repeat(Math.max(1, w - width(left) - width(right))), fill: true }, ...right]

const zone = (pct: number) => (pct >= 80 ? 'error' : pct >= 60 ? 'warning' : 'success')

// The meter's fill split at the zone edges, so a real bar warms as it fills, as the terminal's cells do.
export const zoneParts = (pct: number) => {
  const p = Math.min(100, Math.max(0, pct))
  return [{ n: Math.min(p, 60), c: 'success' }, { n: Math.min(Math.max(p - 60, 0), 20), c: 'warning' }, { n: Math.max(p - 80, 0), c: 'error' }, { n: 100 - p }]
}

// A meter with eighth-cell precision; filled cells take the colour of the zone they sit in, so the bar warms as it fills.
export const meter = (pct: number, w: number): Seg[] => {
  const eighths = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w * 8)
  const out: Seg[] = []
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

export type Reset = { mode: 'compact'; next: string } | { mode: 'clear'; handoff: string }

// Reads the model's context_reset call: the reset to run after the turn, or why it is refused.
export const checkReset = (input: Record<string, unknown>, action: ContextAction): Reset | string => {
  const next = typeof input.next === 'string' ? input.next.trim() : ''
  const handoff = typeof input.handoff === 'string' ? input.handoff.trim() : ''
  if (input.mode === 'compact') return next ? { mode: 'compact', next } : 'Give `next`: the step the work continues with after the compaction.'
  if (input.mode !== 'clear' || action !== 'compact-or-clear') return `mode must be ${action === 'compact-or-clear' ? '"compact" or "clear"' : '"compact"'}.`
  if (handoff.length < HANDOFF_MIN)
    return `A clear needs a \`handoff\` of at least ${HANDOFF_MIN} characters: the new session sees nothing else. Give the goal, what is done, the decisions taken, the files that matter and the next step.`
  return { mode: 'clear', handoff }
}

const resetSpec = (action: ContextAction) => {
  const canClear = action === 'compact-or-clear'
  return {
    name: RESET,
    description: [
      'Compacts this conversation after your turn ends, then sends `next` back to you as a new prompt, so the work goes on without the user.',
      'Call it yourself, without asking, once session-meter has said the context is full and you reach a natural break: a step is done, nothing is half-edited, and the next step is clear. Never call it in the middle of a step.',
      ...(canClear
        ? ['Use mode "clear" instead when the next work does not build on this conversation. The conversation is cleared and the new session sees only your `handoff`, so it must carry the goal, what is done, the decisions taken, the files that matter and the next step.']
        : []),
      'After calling it, end your turn with one short line.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: canClear ? ['compact', 'clear'] : ['compact'] },
        next: { type: 'string', description: 'For compact: the step the work continues with.' },
        ...(canClear ? { handoff: { type: 'string', description: 'For clear: everything the new session needs, in full.' } } : {}),
      },
      required: ['mode'],
    },
    isDeferred: false as const,
  }
}

// The handoff goes to disk before the clear, so a failed submit cannot lose it.
const saveHandoff = async ($: EngineInterface, handoff: string) => {
  const at = new Date(await $.clock.now())
  const cwd = await $.session.cwd()
  const sessionId = await $.session.id()
  const home = (await $.env.get('HOME')) ?? '.'
  const project = (cwd.split('/').filter(Boolean).pop() ?? 'root').replace(/[^\w.-]+/g, '-')
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`
  const path = `${home}/.claude/handoffs/${stamp}-clear-${project}-${sessionId.slice(0, 8)}.md`
  await $.fs.write(path, `# Handoff before /clear\n\n- Cwd: ${cwd}\n- Session: ${sessionId}\n\n${handoff}\n`)
  return path.replace(home, '~')
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
  // The engine's own forks (compaction, memory) carry ids no list names, so they are never cached.
  const type = agentTypes.get(id) ?? (await $.agent.list()).find(a => a.id === id)?.type
  if (type) agentTypes.set(id, type)
  return type ?? 'fork'
}

export const register: Register = (on, options) => {
  const { action, contextAt } = readOptions(options)
  const thresholds = levels(contextAt)
  // ponytail: held in the module, so a hot reload between the call and the turn's end drops the reset.
  let pending: Reset | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ctx', description: 'Show what fills the context window and how fast limits run down' })
    if (action !== 'suggest') await $.tool.register(resetSpec(action))
    await refresh($)
    await sample($, (await read($, reading)).limits)
    if (options.autoOpen !== false) void $.ui.open({ id: PANE, title: 'Session' })
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
    const crossed = cross(r, await read($, fired), thresholds)
    await update($, fired, () => crossed.fired)
    if (crossed.fresh.length === 0) return next(e)
    const now = await $.clock.now()
    await update($, notes, list => [...list, { at: now, text: noteLabel(crossed.fresh) }].slice(-5))
    return next({ ...e, context: [...(e.context ?? []), note(r, crossed.fresh, now, action)] })
  })

  on('tool.call', { tool: RESET_TOOL }, async ($, e) => {
    // After a /clear no session.start runs, so the stored reading is stale until measured again.
    await refresh($)
    const pct = (await read($, reading)).context ?? 0
    const reset = checkReset(e as unknown as Record<string, unknown>, action)
    if (e.agentId !== undefined) return { isError: true as const, result: 'Only the main conversation can reset its context.' }
    if (pct < contextAt) return { isError: true as const, result: `The context is only ${Math.round(pct)}% full; wait for session-meter's note.` }
    if (typeof reset === 'string') return { isError: true as const, result: reset }
    pending = reset
    return { result: `The ${reset.mode} runs when this turn ends. End your turn now with one short line.` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const job = pending
    if (e.agentId !== undefined || !job) return result
    pending = undefined
    // An interrupted turn hands control back to the user: no reset behind their back.
    if (e.reason !== 'answer') return result
    let saved: string | undefined
    try {
      if (job.mode === 'compact') {
        $.ui.toast('session-meter: compacting, then continuing')
        const done = await $.session.compact({ instructions: `The work continues with: ${job.next}` })
        if (done.skip !== undefined) {
          $.ui.toast(`session-meter: compaction skipped: ${done.skip}`)
          return result
        }
        await $.prompt.submit({ text: `session-meter compacted the conversation. Continue: ${job.next}` })
      } else {
        saved = await saveHandoff($, job.handoff)
        $.ui.toast(`session-meter: clearing; handoff saved to ${saved}`)
        await $.command.run({ command: 'clear' })
        await $.prompt.submit({ text: `session-meter cleared the previous conversation. Its handoff, also saved to ${saved}:\n\n${job.handoff}` })
      }
    } catch (err) {
      $.ui.toast(`session-meter: ${job.mode} failed: ${String(err)}${saved ? `; handoff saved to ${saved}` : ''}`)
    }
    return result
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
    const isGrid = e.surface === 'terminal'
    if (!b) return <Text dimColor>Waiting for the first context reading.</Text>

    const draw = (row: Row, width: number) =>
      fit(row, width).map((s, j) => <Text key={String(j)} color={s.c} dimColor={s.d} bold={s.b}>{s.t}</Text>)
    // A row as a flex line, for surfaces that draw text in a proportional font.
    const items = (row: Row) =>
      row.map((s, j) => {
        if ('group' in s) return <Box flexGrow={1} width={0} alignItems="center">{items(s.group)}</Box>
        if ('cells' in s) {
          // The engine takes a flexGrow up to 10000, so parts are weighed per thousand.
          const total = Math.max(1, s.parts.reduce((n, p) => n + p.n, 0))
          return <Box flexGrow={1} height={0.5}>{s.parts.map(p => <Box flexGrow={(p.n / total) * 1000} backgroundColor={p.c ?? TRACK} />)}</Box>
        }
        if ('spark' in s)
          return (
            <Box flexGrow={1} height={2} alignItems="flex-end">
              {s.spark.map(v => <Box flexGrow={1} height={`${Math.max(1, Math.round((Math.min(v, s.max) / Math.max(1, s.max)) * 100))}%`} backgroundColor={s.c} />)}
            </Box>
          )
        if (s.fill) return <Box flexGrow={1} />
        const text = <Text key={String(j)} color={s.c} dimColor={s.d} bold={s.b} wrap="truncate-end">{!s.w ? s.t : s.right ? s.t.trim() : s.t.trimEnd()}</Text>
        return s.w ? <Box width={s.w} flexShrink={0} justifyContent={s.right ? 'flex-end' : 'flex-start'}>{text}</Box> : text
      })
    const line = (row: Row) => (row.length ? <Box alignItems="center">{items(row)}</Box> : <Box height={0.5} />)
    const frame = (title: string, tone: string, rows: Row[], right = '') => {
      if (!isGrid)
        return (
          <Box flexDirection="column" marginTop={2} borderStyle="round" borderColor={tone} borderDimColor>
            <Box marginBottom={1}>
              <Text color={tone} bold>{title}</Text>
              <Box flexGrow={1} />
              {right ? <Text dimColor>{right}</Text> : null}
            </Box>
            {rows.map(line)}
          </Box>
        )
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
              {draw(row, inner)}
              <Text color={tone} dimColor>  │</Text>
            </Text>
          ))}
          <Text color={tone} dimColor>╰{'─'.repeat(w - 2)}╯</Text>
        </Box>
      )
    }

    // Context: one stacked bar of what fills it, the compaction mark, a legend, the size over turns, the heaviest items.
    const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0)
    const bar: Seg[] = used.map(c => ({ t: '█'.repeat(cells(c.tokens, b.window, inner)), c: c.color }))
    const filled = width(bar)
    const mark = b.threshold === undefined ? -1 : Math.min(inner - 1, cells(b.threshold, b.window, inner))
    for (let i = filled; i < inner; i++) bar.push(i === mark ? { t: '┊', c: 'warning' } : { t: '·', d: true, c: mark >= 0 && i > mark ? 'error' : undefined })
    // Real bars mark the compaction point by tinting the room past it.
    const usedTokens = used.reduce((n, c) => n + c.tokens, 0)
    const free = Math.max(0, (b.threshold ?? b.window) - usedTokens)
    const parts = [...used.map(c => ({ n: c.tokens, c: c.color })), { n: free }, { n: Math.max(0, b.window - usedTokens - free), c: 'diffRemovedDimmed' }]
    // The legend is a two-column grid, names left and counts right-aligned in each column.
    const colW = Math.floor((inner - 3) / 2)
    const keys = [
      ...used.map(c => ({ mark: '■', c: c.color, name: c.name, n: tokens(c.tokens) })),
      ...(b.threshold === undefined ? [] : [{ mark: isGrid ? '┊' : '■', c: isGrid ? 'warning' : 'diffRemovedDimmed', name: 'compacts at', n: tokens(b.threshold) }]),
    ]
    const key = (k: (typeof keys)[number]): Row => spread([{ t: `${k.mark} `, c: k.c }, { t: k.name.slice(0, colW - k.n.length - 3) }], [{ t: k.n, d: true }], colW)
    const legend: Row[] = []
    for (let i = 0; i < keys.length; i += 2) {
      const [a, z] = [keys[i], keys[i + 1]]
      if (a) legend.push([{ group: key(a) }, ...(z ? [{ t: '   ' }, { group: key(z) }] : [{ group: [] }])])
    }
    const last = turns.at(-1)
    const prev = turns.at(-2)
    const delta = last !== undefined && prev !== undefined ? last - prev : undefined
    const chartCols = inner - 12
    const chart = turns.length < 2 ? [] : braille(turns, b.window, chartCols, 2)
    const change: Seg = { t: `${delta !== undefined && delta >= 0 ? '+' : '-'}${tokens(Math.abs(delta ?? 0))}`, b: true }
    const contextRows: Row[] = [
      spread([{ t: tokens(b.tokens), b: true }, { t: ` of ${tokens(b.window)}`, d: true }], [{ t: `${Math.round(b.percent)}%`, c: zone(b.percent), b: true }], inner),
      [],
      [{ cells: bar, parts }],
      [],
      ...legend,
      [],
      ...(!chart.length
        ? [[{ t: 'Size over turns shows after two turns.', d: true }]]
        : isGrid
          ? [
              [{ t: chart[0] ?? '', c: 'suggestion' }, { t: '  ' }, change],
              [{ t: chart[1] ?? '', c: 'suggestion' }, { t: '  last turn', d: true }],
            ]
          : [[{ spark: turns.slice(-chartCols * 2), max: b.window, c: 'suggestion' }, { t: '  ' }, change, { t: '  last turn', d: true }]]),
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
      limitRows.push([
        { t: `${win.label} `, b: true, w: 3 },
        { cells: [{ t: '▕', d: true }, ...meter(limit.percentUsed, inner - 18), { t: '▏', d: true }], parts: zoneParts(limit.percentUsed) },
        { t: ` ${pct} `, c: tone, b: true, w: 6, right: true },
        { t: reset, d: true, w: 8, right: true },
      ])
      limitRows.push(
        p.kind === 'measuring'
          ? [{ t: '   measuring pace…', d: true }]
          : p.kind === 'full'
            ? [{ t: `   full in ~${duration(p.inMs)} at this pace`, c: tone }]
            : [{ t: '   lasts until the reset at this pace', d: true }],
      )
      glance.push({ t: `   ${win.label} `, d: true }, { t: `${Math.round(limit.percentUsed)}%`, c: tone, b: true })
    }
    // toTimeString starts with the local HH:MM:SS.
    const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
    if (sent.length) limitRows.push([], ...sent.map(n => [{ t: `${hhmm(n.at)} `, d: true }, { t: `note sent: ${n.text}` }]))
    const limitTone = tones.includes('error') ? 'error' : tones.includes('warning') ? 'warning' : 'success'

    // Tools and Requests share the rows left below; each keeps at least three.
    // The top padding and glance row, each frame's two borders and top margin, and the Requests column header.
    const fixed = 2 + (contextRows.length + 3) + (limitRows.length ? limitRows.length + 3 : 0) + 3 + 4
    const left = Math.max(6, e.props.scroll.bodyRows - fixed)
    const toolCount = Math.max(3, Math.ceil(left / 2))
    const askCount = Math.max(3, left - toolCount)

    const shown = [...calls.filter(t => t.ok === undefined), ...calls.filter(t => t.ok !== undefined)].slice(0, toolCount)
    const running = calls.filter(t => t.ok === undefined).length
    const toolRows: Row[] = shown.length
      ? shown.map(t => {
          const icon = t.ok === undefined ? { t: '◌', c: 'warning' } : t.ok ? { t: '✓', c: 'success' } : { t: '✗', c: 'error' }
          const time = t.ms === undefined ? '…' : elapsed(t.ms)
          return spread([icon, { t: ` ${(t.sub ? `↳${t.name}` : t.name).padEnd(7)} `, b: !t.sub, d: t.sub, w: 11 }, { t: t.target.slice(0, inner - 16), d: true }], [{ t: time, d: true }], inner)
        })
      : [[{ t: 'No tool calls yet.', d: true }]]
    const toolTone = shown.find(t => t.ok !== undefined)?.ok === false ? 'error' : 'success'

    // A right-aligned column n wide.
    const num = (t: string, n: number, s: Omit<Seg, 't'> = {}): Seg => ({ ...s, t: t.padStart(n), w: n, right: true })
    const askRows: Row[] = asks.length
      ? [
          [{ t: 'loop'.padEnd(10), d: true, w: 10 }, num('in', 6, { d: true }), num('out', 6, { d: true }), num('cache', 7, { d: true }), num('time', 7, { d: true })],
          ...asks.slice(0, askCount).map(q => {
            const hit = q.input ? Math.round((q.cached / q.input) * 100) : 0
            const cacheTone = hit < 20 ? 'error' : hit < 50 ? 'warning' : undefined
            return [
              { t: q.agent.padEnd(10).slice(0, 10), b: q.agent === 'main', d: q.agent !== 'main', w: 10 },
              num(tokens(q.input), 6),
              num(tokens(q.output), 6),
              num(`${hit}%`, 7, { c: cacheTone, d: cacheTone === undefined }),
              num(elapsed(q.ms), 7, { d: true }),
            ]
          }),
        ]
      : [[{ t: 'No model requests yet.', d: true }]]
    const lastHit = asks[0] && asks[0].input ? asks[0].cached / asks[0].input : 1
    const model = asks[0]?.model.replace(/^claude-/, '') ?? ''

    return (
      <Box flexDirection="column" paddingTop={1}>
        {isGrid ? <Text>{draw(glance, w - 3)}</Text> : line(glance)}
        {frame('Context', zone(b.percent), contextRows)}
        {limitRows.length ? frame('Limits', limitTone, limitRows) : null}
        {frame('Tools', toolTone, toolRows, running ? `${running} running` : '')}
        {frame('Requests', lastHit < 0.5 ? 'warning' : 'success', askRows, model)}
      </Box>
    )
  })
}
