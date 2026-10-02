import type { BuiltinToolResults, EngineInterface, Register } from 'claude-code'

export type Outcome = 'fast' | 'slow' | 'miss'

// A web search takes seconds even when it goes well; a local one takes well under one.
export const SLOW_MS = { Bash: 3_000, ToolSearch: 3_000, WebSearch: 10_000 }
const DOT: Record<Outcome, string> = { fast: '🟢', slow: '🟡', miss: '🔴' }

// A command is a search when one of its pipeline steps starts with a search program.
export const isSearch = (command: string) => /(?:^|[|;&(`]|\bxargs)\s*(?:\S*\/)?(?:[ef]?grep|rg|ag|ack|find|fd|git\s+grep)\s/.test(command)

export const outcome = (found: boolean, ms: number, slowMs: number): Outcome => (!found ? 'miss' : ms > slowMs ? 'slow' : 'fast')

export const webFound = (results: BuiltinToolResults['WebSearch']['results']) => results.some(r => typeof r !== 'string' && r.content.length > 0)

export function statusText(history: readonly Outcome[]): string | undefined {
  if (history.length === 0) return undefined
  const count = (o: Outcome) => history.filter(h => h === o).length
  return `🔍 ${DOT.fast} ${count('fast')} ${DOT.slow} ${count('slow')} ${DOT.miss} ${count('miss')} · last ${history.slice(-5).map(o => DOT[o]).join('')}`
}

let history: Outcome[] = []

function record($: EngineInterface, o: Outcome) {
  history.push(o)
  $.ui.status(statusText(history))
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isSearch(e.command) || e.run_in_background) return next(e)
    const at = await $.clock.now()
    const r = await next(e)
    if (r.deny !== undefined || (!r.isError && (r.result.interrupted || r.result.backgroundTaskId))) return r
    // grep and find print nothing when nothing matches; an error found nothing either.
    record($, outcome(!r.isError && r.result.stdout.trim() !== '', (await $.clock.now()) - at, SLOW_MS.Bash))
    return r
  })

  on('tool.call', { tool: 'WebSearch' }, async ($, e, next) => {
    const at = await $.clock.now()
    const r = await next(e)
    if (r.deny !== undefined) return r
    record($, outcome(!r.isError && webFound(r.result.results), (await $.clock.now()) - at, SLOW_MS.WebSearch))
    return r
  })

  on('tool.call', { tool: 'ToolSearch' }, async ($, e, next) => {
    const at = await $.clock.now()
    const r = await next(e)
    if (r.deny !== undefined) return r
    record($, outcome(!r.isError && r.result.matches.length > 0, (await $.clock.now()) - at, SLOW_MS.ToolSearch))
    return r
  })

  on('session.end', async ($, e, next) => {
    history = []
    $.ui.status(undefined)
    return next(e)
  })
}
