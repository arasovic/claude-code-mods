import type { Register } from 'claude-code'

// shortcut: one fixed size, and docs count as much as code; make it an option if small or docs-only commits ping too often.
const MIN_LINES = 30
// code-review, security-review, a code-reviewer agent and the like.
const REVIEW = /review/i
const COMMIT = /\bgit\b[^;&|\n]*\bcommit\b/

export const note = (sha: string, lines: number) =>
  `review-ping: an automatic note the user does not see. Commit ${sha} changed ${lines} lines, and no review ran since the commit before it. Before you call the work done, review it: use a code review skill or reviewer agent if you have one, such as code-review; otherwise read \`git show ${sha}\` and look for bugs, missed cases and leftovers. Skip this if the user asked for no review.`

// git commit prints "[main abc1234] message", then " 2 files changed, 31 insertions(+), 4 deletions(-)".
// A root commit or a detached HEAD puts more words before the hash, so the hash is the last word in the brackets.
export function committed(output: string) {
  const sha = [...output.matchAll(/^\[[^\]\n]* ([0-9a-f]{7,40})\] /gm)].at(-1)?.[1]
  if (!sha) return undefined
  let lines = 0
  for (const [, added, removed] of output.matchAll(/^ \d+ files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/gm)) lines += Number(added ?? 0) + Number(removed ?? 0)
  return { sha, lines }
}

export const register: Register = on => {
  // A review covers the next commit, even with edits in between; every commit clears it.
  let isReviewed = false
  // A review run while a note waits answers that note: it looks back at the noted commit, so it covers nothing ahead.
  // A note waits until the next commit, so a skipped note cannot eat a later review.
  let isNoted = false
  const review = () => {
    if (isNoted) isNoted = false
    else isReviewed = true
  }
  const ran = (r: { deny?: string; isError?: boolean }) => r.deny === undefined && !r.isError

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const r = await next(e)
    if (ran(r) && !e.agentId && REVIEW.test(e.skill)) review()
    return r
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const r = await next(e)
    if (ran(r) && !e.agentId && REVIEW.test(e.subagent_type ?? '')) review()
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if (REVIEW.test(e.command?.name ?? '')) review()
    return next(e)
  })

  // A subagent that commits is not told to review: it often cannot, and the main thread reviews its work.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError || e.agentId || !COMMIT.test(e.command)) return r
    // shortcut: reads git's own summary, so `git commit -q` sends nothing; run `git show --numstat` if that matters.
    const commit = committed(r.result.stdout)
    if (!commit) return r
    const wasReviewed = isReviewed
    isReviewed = isNoted = false
    if (wasReviewed || commit.lines < MIN_LINES) return r
    isNoted = true
    $.ui.toast(`commit ${commit.sha} changed ${commit.lines} lines with no review; Claude was asked to review it`)
    return { ...r, context: [...(r.context ?? []), note(commit.sha, commit.lines)] }
  })

  on('session.end', async ($, e, next) => ((isReviewed = isNoted = false), next(e)))
}
