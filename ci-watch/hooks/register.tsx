import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CiWatchBroken, CiWatchItem, CiWatchSpec } from '../types'

const POLL_MS = 10_000
const NO_RUN_MS = 90_000
const MAX_WATCH_MS = 60 * 60_000
// ponytail: covers daily and weekly schedules; a monthly one whose last run failed is missed.
const LOOKBACK_MS = 14 * 24 * 60 * 60_000
const BAR_WIDTH = 20
const BAD = ['failure', 'timed_out', 'startup_failure']

type Run = { workflowName: string; workflowDatabaseId: number; event: string; headBranch: string; status: string; conclusion: string; startedAt: string }

const watches = atom({ plugin: 'ci-watch', key: 'watches' } as const, [] as CiWatchItem[])
const broken = atom({ plugin: 'ci-watch', key: 'broken' } as const, [] as CiWatchBroken[])
// One watch per ref and commit: a branch push and the PR opened on it merge into one row instead of two.
const active = new Map<string, CiWatchSpec>()
let repoUrl: string | undefined

// Bash calls start in the session cwd, so a push from elsewhere arrives as `cd <repo> && git push` or `git -C <repo>`.
// ponytail: only a leading cd or git -C; pushd and subshells fall back to the session cwd.
export const repoDir = (command: string, home: string, root: string) => {
  const m = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(&&|;)/) ?? command.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/)
  if (!m?.[1]) return root
  const dir = m[1].replace(/^["']|["']$/g, '')
  if (dir === '~' || dir.startsWith('~/')) return home + dir.slice(1)
  return dir.startsWith('/') ? dir : `${root}/${dir}`
}

// Only the session's repo is watched; a push or PR in another checkout is someone else's. Worktrees live under the root.
export const isInside = (dir: string, root: string) => !dir.split('/').includes('..') && (dir === root || dir.startsWith(`${root}/`))

// The engine's gitOperation.push covers branches only; tag pushes are read from git's own output.
export const pushedTag = (output: string) => output.match(/\[new tag\]\s+\S+\s*->\s*(\S+)/)?.[1]

const runName = (r: Pick<Run, 'workflowName' | 'event'>) => (r.event === 'pull_request' ? `${r.workflowName} (PR)` : r.workflowName)

export const summarize = (label: string, runs: Pick<Run, 'workflowName' | 'event' | 'conclusion'>[]) => {
  const failed = runs.filter(r => r.conclusion !== 'success' && r.conclusion !== 'skipped' && r.conclusion !== 'neutral')
  return failed.length
    ? `✗ ${label}: ${failed.map(r => `${runName(r)} ${r.conclusion}`).join(', ')}`
    : `✓ ${label}: ${runs.map(runName).join(', ')} passed`
}

// Progress is elapsed time against the workflow's last successful run: monotonic, unlike step counts,
// which drop when a dependent job starts and reveals its steps. Never shows full until the run completes.
export const bar = (elapsedMs: number, expectedMs: number | null) => {
  const filled = expectedMs ? Math.min(BAR_WIDTH - 1, Math.round((elapsedMs / expectedMs) * BAR_WIDTH)) : 0
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

export const duration = (ms: number) => `${Math.floor(ms / 60_000)}m${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}s`

async function gh($: EngineInterface, cwd: string, args: string[]) {
  const r = await $.process.run(['gh', ...args], { cwd, timeoutMs: 20_000 }).catch(() => undefined)
  return r?.exitCode === 0 ? r.stdout.trim() : undefined
}

async function git($: EngineInterface, cwd: string, args: string[]) {
  const r = await $.process.run(['git', ...args], { cwd }).catch(() => undefined)
  return r?.exitCode === 0 ? r.stdout.trim() : undefined
}

async function lastSuccessMs($: EngineInterface, cwd: string, workflowId: number) {
  const out = await gh($, cwd, ['run', 'list', '-w', String(workflowId), '--status', 'success', '-L', '1', '--json', 'startedAt,updatedAt'])
  const [r] = out ? (JSON.parse(out) as { startedAt: string; updatedAt: string }[]) : []
  return r ? Date.parse(r.updatedAt) - Date.parse(r.startedAt) : null
}

async function setItem($: EngineInterface, item: CiWatchItem) {
  await update($, watches, list => [...list.filter(w => w.id !== item.id), item])
}

const copy = (w: CiWatchSpec): CiWatchSpec => ({ ...w, labels: [...w.labels], required: { ...w.required } })

// A watch ends once every event it waits for has runs and none is pending. An event that never produced a run
// stops being waited for after NO_RUN_MS, so a push CI that finishes before `gh pr create` does not end the watch,
// and a push to a branch whose CI runs only on pull_request still ends.
async function watch($: EngineInterface, spec: CiWatchSpec, isResume = false) {
  const id = `${spec.ref}@${spec.sha.slice(0, 7)}`
  const existing = active.get(id)
  if (existing) {
    Object.assign(existing.required, spec.required)
    for (const l of spec.labels) if (!existing.labels.includes(l)) existing.labels.push(l)
    return
  }

  const w = copy(spec)
  active.set(id, w)
  const expected = new Map<number, number | null>()
  let isBusy = false
  if (!isResume) await setItem($, { id, label: w.labels.join(', '), runs: [], spec: copy(w) })

  const finish = async (result: string) => {
    active.delete(id)
    timer.cancel()
    await setItem($, { id, label: w.labels.join(', '), runs: [], result, isFailed: result.startsWith('✗') })
    $.ui.toast(result)
  }

  const timer = $.clock.every(POLL_MS, async () => {
    if (isBusy || active.get(id) !== w) return
    isBusy = true
    try {
      const out = await gh($, w.cwd, ['run', 'list', '--commit', w.sha, '--json', 'workflowName,workflowDatabaseId,event,headBranch,status,conclusion,startedAt'])
      const runs = (out ? (JSON.parse(out) as Run[]) : []).filter(r => r.headBranch === w.ref && r.event in w.required)
      const now = await $.clock.now()
      const label = w.labels.join(', ')
      const pending = runs.filter(r => r.status !== 'completed')
      const isAwaiting = Object.entries(w.required).some(([ev, since]) => !runs.some(r => r.event === ev) && now - since <= NO_RUN_MS)
      if (!isAwaiting && !runs.length) {
        await finish(`${label}: no workflow triggered`)
      } else if (!isAwaiting && !pending.length) {
        await finish(summarize(label, runs))
      } else if (now - w.startedAt > MAX_WATCH_MS) {
        await finish(`✗ ${label}: still running after 60 min`)
      } else {
        for (const r of pending) {
          if (!expected.has(r.workflowDatabaseId)) expected.set(r.workflowDatabaseId, await lastSuccessMs($, w.cwd, r.workflowDatabaseId))
        }
        const rows = pending.map(r => ({
          name: runName(r),
          elapsedMs: Math.max(0, now - Date.parse(r.startedAt)) || 0,
          expectedMs: expected.get(r.workflowDatabaseId) ?? null,
        }))
        await setItem($, { id, label, runs: rows, spec: copy(w) })
      }
    } finally {
      isBusy = false
    }
  })
}

type BashResult = { stdout: string; stderr: string; gitOperation?: { push?: { branch: string }; pr?: { number: number; url?: string; action: string } } }

async function track($: EngineInterface, command: string, result: BashResult) {
  const op = result.gitOperation
  const tag = /\bgit\b[^;&|]*\bpush\b/.test(command) ? pushedTag(`${result.stdout}\n${result.stderr}`) : undefined
  const pr = op?.pr?.action === 'created' ? op.pr : undefined
  if (!op?.push && !pr && !tag) return

  const root = await $.session.cwd()
  const cwd = repoDir(command, (await $.env.get('HOME')) ?? '', root)
  if (!isInside(cwd, root)) return
  const startedAt = await $.clock.now()
  const spec = (sha: string, ref: string, label: string, events: string[]): CiWatchSpec => ({
    cwd: root, sha, ref, labels: [label], required: Object.fromEntries(events.map(ev => [ev, startedAt])), startedAt,
  })

  if (op?.push) {
    const { branch } = op.push
    // ponytail: assumes the remote is origin; another remote falls back to the local branch's sha.
    const sha = (await git($, cwd, ['rev-parse', `origin/${branch}`])) ?? (await git($, cwd, ['rev-parse', branch]))
    // A push to a branch with an open PR also runs its pull_request workflows.
    if (sha) await watch($, spec(sha, branch, `push ${branch}`, ['push', 'pull_request']))
  }
  if (tag) {
    const sha = await git($, cwd, ['rev-parse', `${tag}^{commit}`])
    if (sha) await watch($, spec(sha, tag, `tag ${tag}`, ['push']))
  }
  if (pr) {
    repoUrl ??= await gh($, root, ['repo', 'view', '--json', 'url', '-q', '.url'])
    if (pr.url && (!repoUrl || !pr.url.startsWith(`${repoUrl}/`))) return
    const out = await gh($, root, ['pr', 'view', String(pr.number), '--json', 'headRefOid,headRefName'])
    const head = out ? (JSON.parse(out) as { headRefOid: string; headRefName: string }) : undefined
    if (head) await watch($, spec(head.headRefOid, head.headRefName, `PR #${pr.number}`, ['pull_request']))
  }
}

// A reload drops the old module's timers; an unfinished row resumes from its spec, one without a spec would stay frozen and is dropped.
async function resumeWatches($: EngineInterface) {
  const list = await read($, watches)
  if (list.some(w => !w.result && !w.spec)) await update($, watches, l => l.filter(w => w.result || w.spec))
  for (const w of list) {
    if (!w.result && w.spec) await watch($, w.spec, true)
  }
}

// Lists workflows whose latest scheduled run failed; a workflow without a schedule trigger never appears.
async function scanSchedules($: EngineInterface, cwd: string) {
  const root = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (!root) return
  const since = new Date((await $.clock.now()) - LOOKBACK_MS).toISOString().slice(0, 10)
  const out = await gh($, root, ['run', 'list', '--event', 'schedule', '--created', `>=${since}`, '-L', '100', '--json', 'workflowDatabaseId,conclusion'])
  if (!out) return
  const ids = [...new Set((JSON.parse(out) as { workflowDatabaseId: number; conclusion: string }[]).filter(r => BAD.includes(r.conclusion)).map(r => r.workflowDatabaseId))]
  const dismissed = ((await $.store.get(`dismissed:${root}`)) ?? []) as string[]
  const found: CiWatchBroken[] = []
  for (const id of ids) {
    const last = await gh($, root, ['run', 'list', '-w', String(id), '--event', 'schedule', '-L', '1', '--json', 'workflowName,conclusion,createdAt,url'])
    const [run] = last ? (JSON.parse(last) as { workflowName: string; conclusion: string; createdAt: string; url: string }[]) : []
    if (run && BAD.includes(run.conclusion) && !dismissed.includes(run.url)) {
      found.push({ workflow: run.workflowName, at: run.createdAt.slice(0, 10), url: run.url })
    }
  }
  await update($, broken, () => found)
}

async function dismiss($: EngineInterface) {
  const root = await git($, await $.session.cwd(), ['rev-parse', '--show-toplevel'])
  const shown = await read($, broken)
  if (root) {
    const prev = ((await $.store.get(`dismissed:${root}`)) ?? []) as string[]
    await $.store.set(`dismissed:${root}`, [...prev, ...shown.map(b => b.url)].slice(-50))
  }
  await update($, broken, () => [])
}

export const register: Register = (on, options) => {
  const isScanOn = options.scheduled === true

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError && ran.result) {
      void track($, e.command, ran.result as BashResult).catch(() => undefined)
    }
    return ran
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    void resumeWatches($).catch(() => undefined)
    if (isScanOn) void scanSchedules($, e.cwd).catch(() => undefined)
    else await update($, broken, () => [])
    return started
  })

  // A finished watch stays in the band until the person sends their next prompt.
  on('prompt.submit', async ($, e, next) => {
    if ((await read($, watches)).some(w => w.result)) await update($, watches, list => list.filter(w => !w.result))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const items = await read($, watches)
    const list = await read($, broken)
    if (e.props.hasSurvey || (!items.length && !list.length)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = items.flatMap(w => {
      if (w.result) return [<Text key={w.id} color={w.isFailed ? 'red' : w.result.startsWith('✓') ? 'green' : undefined}>{w.result}</Text>]
      if (!w.runs.length) return [<Text key={w.id} dimColor>{`⟳ ${w.label} · waiting for workflows…`}</Text>]
      return w.runs.map((r, i) => (
        <Text key={`${w.id}:${i}`}>
          {`⟳ ${w.label} · ${r.name} ${bar(r.elapsedMs, r.expectedMs)} ${duration(r.elapsedMs)}${r.expectedMs ? ` / ~${duration(r.expectedMs)}` : ''}`}
        </Text>
      ))
    })
    for (const b of list) {
      rows.push(<Text key={b.url} color="red">{`✗ scheduled "${b.workflow}" failed (${b.at}) ${b.url}`}</Text>)
    }
    if (list.length) rows.push(<Button key="dismiss" label="Dismiss" onPress={() => dismiss($)} />)

    return (
      <Box flexDirection="column">
        {await next(e)}
        {rows}
      </Box>
    )
  })
}
