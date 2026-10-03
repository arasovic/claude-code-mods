import type { BuiltinToolResults, EngineInterface, Register } from 'claude-code'

export type Outcome = 'fast' | 'slow' | 'miss'

const DOT: Record<Outcome, string> = { fast: '🟢', slow: '🟡', miss: '🔴' }

// A command is a search when one of its pipeline steps starts with a search program.
export const isSearch = (command: string) => /(?:^|[|;&(`]|\bxargs)\s*(?:\S*\/)?(?:[ef]?grep|rg|ag|ack|find|fd|git\s+grep)\s/.test(command)

// A find that ends a run of misses took several tries.
export const outcome = (found: boolean, previous: Outcome | undefined): Outcome => (!found ? 'miss' : previous === 'miss' ? 'slow' : 'fast')

export const webFound = (results: BuiltinToolResults['WebSearch']['results']) => results.some(r => typeof r !== 'string' && r.content.length > 0)

export function statusText(history: readonly Outcome[]): string | undefined {
  if (history.length === 0) return undefined
  const count = (o: Outcome) => history.filter(h => h === o).length
  return `🔍 ${DOT.fast} ${count('fast')} ${DOT.slow} ${count('slow')} ${DOT.miss} ${count('miss')} · last ${history.slice(-5).map(o => DOT[o]).join('')}`
}

let history: Outcome[] = []

function record($: EngineInterface, found: boolean) {
  history.push(outcome(found, history.at(-1)))
  $.ui.status(statusText(history))
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isSearch(e.command) || e.run_in_background) return next(e)
    const r = await next(e)
    if (r.deny !== undefined || (!r.isError && (r.result.interrupted || r.result.backgroundTaskId))) return r
    // grep and find print nothing when nothing matches; an error found nothing either.
    record($, !r.isError && r.result.stdout.trim() !== '')
    return r
  })

  on('tool.call', { tool: 'WebSearch' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined) record($, !r.isError && webFound(r.result.results))
    return r
  })

  on('tool.call', { tool: 'ToolSearch' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined) record($, !r.isError && r.result.matches.length > 0)
    return r
  })

  on('session.end', async ($, e, next) => ((history = []), $.ui.status(undefined), next(e)))
}
