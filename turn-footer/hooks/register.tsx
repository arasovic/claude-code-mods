import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FooterRunning, FooterStats } from '../types'

const EMPTY: FooterStats = { tools: 0, failed: 0, requests: 0, agents: [], input: 0, cached: 0, output: 0 }

const live = atom({ plugin: 'turn-footer', key: 'live' } as const, EMPTY)
const done = atom({ plugin: 'turn-footer', key: 'done' } as const, [] as { durationMs: number; stats: FooterStats }[])
const running = atom({ plugin: 'turn-footer', key: 'running' } as const, [] as FooterRunning[])

export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// The summary's parts, each with a tone: failures and a cold cache stand out, the rest stays dim like the engine's line.
export const summary = (s: FooterStats) => {
  const parts: { t: string; c?: string }[] = []
  if (s.tools) parts.push({ t: plural(s.tools, 'tool') })
  if (s.failed) parts.push({ t: `${s.failed} failed`, c: 'error' })
  if (s.agents.length) parts.push({ t: plural(s.agents.length, 'agent') })
  if (s.requests) parts.push({ t: plural(s.requests, 'request') })
  if (s.input || s.output) parts.push({ t: `${tokens(s.input)} in  ${tokens(s.output)} out` })
  if (s.input) {
    const hit = Math.round((s.cached / s.input) * 100)
    parts.push({ t: `cache ${hit}%`, c: hit < 20 ? 'error' : hit < 50 ? 'warning' : undefined })
  }
  return parts
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    await update($, live, () => EMPTY)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const id = e.tool_use_id ?? `${e.tool}:${at}`
    const main = e.agentId === undefined
    if (main) await update($, running, list => [...list, { id, name: e.tool.startsWith('mcp__') ? (e.tool.split('__').at(-1) ?? e.tool) : e.tool, at }])
    let ok = false
    try {
      const result = await next(e)
      ok = result.deny === undefined && !result.isError
      return result
    } finally {
      if (main) await update($, running, list => list.filter(t => t.id !== id))
      await update($, live, s => ({ ...s, tools: s.tools + 1, failed: s.failed + (ok ? 0 : 1) }))
    }
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (usage) {
      try {
        const agent = e.agentId
        await update($, live, s => ({
          ...s,
          requests: s.requests + 1,
          agents: agent && !s.agents.includes(agent) ? [...s.agents, agent] : s.agents,
          input: s.input + usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
          cached: s.cached + usage.cache_read_input_tokens,
          output: s.output + usage.output_tokens,
        }))
      } catch {
        // The summary is a convenience: a failed write must never break the model's response.
      }
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's run is a turn of its own; its steps already counted toward the main turn.
    if (e.agentId === undefined) {
      const stats = await read($, live)
      // The footer line carries no turn id, only the duration this event reports, so that is the join key.
      await update($, done, list => [...list, { durationMs: e.durationMs, stats }].slice(-100))
    }
    return next(e)
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const drawn = await next(e)
    const found = (await read($, done)).findLast(d => d.durationMs === e.props.durationMs)
    if (!found) return drawn
    const { Box, Text } = $.ui.resolve(e)
    // The engine's line fills the row, so the summary goes on its own line under it, indented past the glyph.
    return (
      <Box flexDirection="column">
        {drawn}
        <Text>
          <Text>{'  '}</Text>
          {summary(found.stats).map((p, i) => (
            <Text key={String(i)}>
              {i ? <Text dimColor>{'  ·  '}</Text> : null}
              <Text color={p.c} dimColor={p.c === undefined}>
                {p.t}
              </Text>
            </Text>
          ))}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const tool = (await read($, running)).at(-1)
    if (!tool || e.props.mode !== 'tool-use') return next(e)
    const now = await $.clock.now()
    return next({ ...e, props: { ...e.props, suffix: `… ${tool.name} ${clock(now - tool.at)}` } })
  })
}
