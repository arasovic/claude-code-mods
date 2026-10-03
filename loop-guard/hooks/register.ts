import type { Register } from 'claude-code'

export const NOTE = 'loop-guard: an automatic note the user does not see. This exact call just failed again with the same error. Do not run it a third time. Re-read the error, question the assumption behind the call, then try a different approach or ask the user.'

// tool_use_id differs on every call, and the model words a Bash or Agent description anew each time.
// agentId stays, so a subagent's failures are its own.
export const callKey = (e: object) => JSON.stringify({ ...e, tool_use_id: undefined, description: undefined })

// A success of the call clears both.
const lastErrorByCall = new Map<string, string>()
const noted = new Set<string>()

const forget = () => (lastErrorByCall.clear(), noted.clear())

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    const key = callKey(e)
    if (!r.isError) return (lastErrorByCall.delete(key), noted.delete(key), r)
    // Same call, same error: nothing changed between the two tries. A rerun after a fix fails differently.
    const error = r.text ?? JSON.stringify(r.result)
    if (lastErrorByCall.get(key) !== error) return (lastErrorByCall.set(key, error), r)
    if (noted.has(key)) return r
    noted.add(key)
    // The toast is titled with the mod's name.
    $.ui.toast(`the same ${e.tool} call failed twice; Claude was told to change approach`)
    return { ...r, context: [...(r.context ?? []), NOTE] }
  })

  // An interrupt fails the running call with the same text every time; the user stopped it, Claude did not loop.
  on('turn.complete', async ($, e, next) => (e.isAborted && forget(), next(e)))
  on('session.end', async ($, e, next) => (forget(), next(e)))
}
