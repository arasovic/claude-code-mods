import type { Register } from 'claude-code'

export const NOTE = 'loop-guard: an automatic note the user does not see. This exact call just failed again with the same error. Do not run it a third time. Re-read the error, question the assumption behind the call, then try a different approach or ask the user.'

// The last error of each failing call, by loop, tool and arguments; a success clears it.
const failed = new Map<string, string>()

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    // tool_use_id differs on every call, and the model words a Bash or Agent description anew each time.
    // agentId stays, so a subagent's failures are its own.
    const key = JSON.stringify({ ...e, tool_use_id: undefined, description: undefined })
    if (!r.isError) {
      failed.delete(key)
      return r
    }
    // Same call, same error: nothing changed between the two tries. A rerun after a fix fails differently.
    const error = r.text ?? JSON.stringify(r.result)
    const repeat = failed.get(key) === error
    failed.set(key, error)
    return repeat ? { ...r, context: [...(r.context ?? []), NOTE] } : r
  })

  on('session.end', async ($, e, next) => (failed.clear(), next(e)))
}
