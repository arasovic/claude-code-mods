import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LedgerFile, LedgerGit, LedgerGitFile } from '../types'

const PANE = 'changes'

const files = atom({ plugin: 'change-ledger', key: 'files' } as const, [] as LedgerFile[])
const git = atom({ plugin: 'change-ledger', key: 'git' } as const, null as LedgerGit | null)

// Subagent ids never change type, so one lookup per id is enough.
const agentTypes = new Map<string, string>()

// A final newline ends the last line; it does not start another.
export const lines = (text: string) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0)

// A path's folder: relative inside the session folder, the last two folders when far outside it.
export const folder = (path: string, cwd: string) => {
  const outside = !path.startsWith(`${cwd}/`)
  const parts = (outside ? path : path.slice(cwd.length + 1)).split('/').slice(0, -1)
  if (!parts.length) return './'
  return outside && parts.filter(Boolean).length > 2 ? `…/${parts.slice(-2).join('/')}/` : `${parts.join('/')}/`
}

// An edit's added and removed lines, not counting the lines old and new share at either end.
export const lineDelta = (before: string, after: string) => {
  const a = before.split('\n')
  const b = after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { added: b.length - head - tail, removed: a.length - head - tail }
}

export const parseStatus = (text: string) => {
  const [head = '', ...rest] = text.split('\n')
  const branch = head.replace(/^## /, '').split('...')[0]?.replace(/^No commits yet on /, '') ?? ''
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
  const entries = rest.filter(Boolean).map(l => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3).split(' -> ').at(-1) ?? '' }))
  return { branch, ahead, behind, entries }
}

export const parseNumstat = (text: string) => {
  const out = new Map<string, { added: number; removed: number }>()
  for (const l of text.split('\n')) {
    const [a, r, ...p] = l.split('\t')
    // Binary files report "-" for both counts.
    if (p.length && a !== '-') out.set(p.join('\t').split(' => ').at(-1) ?? '', { added: Number(a), removed: Number(r) })
  }
  return out
}

// A diffstat bar like git's: adds then removes, scaled to the largest change listed.
export const statBar = (added: number, removed: number, max: number, w: number) => {
  const total = added + removed
  const cellsUsed = max > 0 ? Math.max(total > 0 ? 1 : 0, Math.round((total / max) * w)) : 0
  const plus = total ? Math.round((added / total) * cellsUsed) : 0
  return { plus, minus: cellsUsed - plus, rest: w - cellsUsed }
}

export const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

const agentLabel = async ($: EngineInterface, id: string | undefined) => {
  if (!id) return 'main'
  // The engine's own forks (compaction, memory) carry ids no list names, so they are never cached.
  const type = agentTypes.get(id) ?? (await $.agent.list()).find(a => a.id === id)?.type
  if (type) agentTypes.set(id, type)
  return type ?? 'fork'
}

const record = async ($: EngineInterface, path: string, delta: { added: number; removed: number }, agentId: string | undefined, created: boolean) => {
  const at = await $.clock.now()
  const agent = await agentLabel($, agentId)
  await update($, files, list => {
    const prev = list.find(f => f.path === path)
    const next: LedgerFile = prev
      ? { ...prev, added: prev.added + delta.added, removed: prev.removed + delta.removed, edits: prev.edits + 1, at, agents: prev.agents.includes(agent) ? prev.agents : [...prev.agents, agent] }
      : { path, ...delta, edits: 1, at, agents: [agent], created }
    return [next, ...list.filter(f => f.path !== path)]
  })
}

const refreshGit = async ($: EngineInterface) => {
  const repo = await $.session.repo().catch(() => null)
  if (!repo) return update($, git, () => null)
  const status = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { cwd: repo.root })
  if (status.exitCode !== 0) return
  // A repository without a first commit has no HEAD to diff against; its files are all new.
  const numstat = await $.process.run(['git', 'diff', '--numstat', 'HEAD'], { cwd: repo.root })
  const counts = numstat.exitCode === 0 ? parseNumstat(numstat.stdout) : new Map<string, { added: number; removed: number }>()
  const s = parseStatus(status.stdout)
  const changed: LedgerGitFile[] = s.entries.map(f => ({ ...f, ...counts.get(f.path) }))
  await update($, git, () => ({ root: repo.root, branch: s.branch, ahead: s.ahead, behind: s.behind, files: changed }))
}

// Rows are runs of styled text. The terminal draws them on a grid of cells, so frames pad and cut them exactly.
// Other surfaces draw text in a proportional font, where spaces line nothing up: there a row is a flex line.
// `fill` stretches, `w` is a column that many characters wide (`right` aligns it), and a Bar draws `parts`
// as real bars in place of its `cells`, `w` wide or stretching.
type Seg = { t: string; c?: string; d?: boolean; b?: boolean; fill?: boolean; w?: number; right?: boolean }
type Bar = { cells: Seg[]; parts: { n: number; c?: string }[]; w?: number }
type Row = (Seg | Bar)[]

// The empty part of a bar where the surface draws real bars.
const TRACK = 'userMessageBackgroundHover'

const segs = (row: Row): Seg[] => row.flatMap(s => ('t' in s ? [s] : s.cells))

const width = (row: Row) => segs(row).reduce((n, s) => n + s.t.length, 0)

const fit = (row: Row, w: number): Seg[] => {
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'changes', description: 'Show the files this session changed, beside the git working tree' })
    return next(e)
  })

  on('command.run', { command: 'changes' }, async $ => {
    await refreshGit($)
    const opened = await $.ui.open({ id: PANE, title: 'Changes' })
    return { text: opened.isPlaced ? 'Changes pane opened.' : `Changes pane is waiting: ${opened.reason}` }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && !result.isError) await record($, e.file_path, lineDelta(e.old_string, e.new_string), e.agentId, false)
    return result
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    // The file as it was, so an overwrite counts its old lines as removed.
    const before = await $.fs.read(e.file_path).then(
      r => (typeof r === 'string' ? r : null),
      () => null,
    )
    const result = await next(e)
    if (result.deny === undefined && !result.isError)
      await record($, e.file_path, before === null ? { added: lines(e.content), removed: 0 } : lineDelta(before, e.content), e.agentId, before === null)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await refreshGit($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, files)
    const tree = await read($, git)
    const now = await $.clock.now()
    const cwd = await $.session.cwd()
    const w = Math.max(28, e.props.bodyColumns - 1)
    const inner = w - 6
    const isGrid = e.surface === 'terminal'

    const draw = (row: Row, width: number) =>
      fit(row, width).map((s, j) => <Text key={String(j)} color={s.c} dimColor={s.d} bold={s.b}>{s.t}</Text>)
    // A row as a flex line, for surfaces that draw text in a proportional font.
    const items = (row: Row) =>
      row.map((s, j) => {
        if ('cells' in s) {
          const total = Math.max(1, s.parts.reduce((n, p) => n + p.n, 0))
          return (
            <Box height={0.5} {...(s.w ? { width: s.w, flexShrink: 0 } : { flexGrow: 1 })}>
              {s.parts.map(p => <Box flexGrow={(p.n / total) * 1000} backgroundColor={p.c ?? TRACK} />)}
            </Box>
          )
        }
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

    const name = (path: string) => path.split('/').pop() ?? path
    const counts = (added: number, removed: number): Row => [
      { t: `+${added}`.padStart(5), c: 'success', w: 5, right: true },
      { t: ` −${removed}`.padEnd(6), c: 'error', w: 6 },
    ]

    const added = list.reduce((n, f) => n + f.added, 0)
    const removed = list.reduce((n, f) => n + f.removed, 0)
    const glance: Row = list.length
      ? [{ t: `${list.length} ${list.length === 1 ? 'file' : 'files'}  `, b: true }, { t: `+${added}`, c: 'success' }, { t: ` −${removed}`, c: 'error' }]
      : [{ t: 'No edits yet', d: true }]
    if (tree) glance.push({ t: `   ${tree.branch}`, c: 'suggestion' }, ...(tree.ahead ? [{ t: ` ↑${tree.ahead}`, d: true }] : []), ...(tree.behind ? [{ t: ` ↓${tree.behind}`, c: 'warning' }] : []))

    // The git frame lists every changed path: the ones this session edited get a filled dot, the rest (shell, you) an empty one.
    const touched = new Set(list.map(f => f.path))
    const GIT_MAX = 8
    const gitRows: Row[] = tree
      ? tree.files.length
        ? tree.files.slice(0, GIT_MAX).map(f => {
            const mine = touched.has(`${tree.root}/${f.path}`)
            const tone = f.status === '??' || f.status === 'A' ? 'success' : f.status === 'D' ? 'error' : 'warning'
            const right: Row = f.added === undefined ? [{ t: f.status === '??' ? 'new' : '', d: true }] : counts(f.added, f.removed ?? 0)
            return spread([{ t: mine ? '● ' : '○ ', c: mine ? 'suggestion' : undefined, d: !mine }, { t: f.status.padEnd(3), c: tone, w: 3 }, { t: f.path, d: !mine }], right, inner)
          })
        : [[{ t: 'Working tree clean.', d: true }]]
      : []
    if (tree && tree.files.length > GIT_MAX) gitRows.push([{ t: `+${tree.files.length - GIT_MAX} more`, d: true }])

    // Edits get the rows left after the top padding, the glance row and the git frame; each file takes two rows plus a blank between files.
    const fixed = 2 + 3 + (tree ? gitRows.length + 3 : 0)
    const room = Math.max(5, e.props.scroll.bodyRows - fixed)
    const shown = list.slice(0, Math.max(1, Math.floor((room + 1) / 3)))
    const max = Math.max(1, ...shown.map(f => f.added + f.removed))
    const editRows: Row[] = shown.length
      ? shown.flatMap((f, i) => {
          const bar = statBar(f.added, f.removed, max, 8)
          const top = spread(
            [{ t: name(f.path), b: true }, ...(f.created ? [{ t: ' new', c: 'success' }] : [])],
            [
              {
                cells: [{ t: '■'.repeat(bar.plus), c: 'success' }, { t: '■'.repeat(bar.minus), c: 'error' }, { t: '·'.repeat(bar.rest), d: true }],
                parts: [{ n: bar.plus, c: 'success' }, { n: bar.minus, c: 'error' }, { n: bar.rest }],
                w: 8,
              },
              ...counts(f.added, f.removed),
            ],
            inner,
          )
          const sub = spread([{ t: `  ${folder(f.path, cwd)}`, d: true }], [{ t: `${f.agents.join(', ')} · ${f.edits}× · ${ago(now - f.at)}`, d: true }], inner)
          return i ? [[], top, sub] : [top, sub]
        })
      : [[{ t: 'Files Claude edits or writes show here.', d: true }]]
    const more = list.length - shown.length

    return (
      <Box flexDirection="column" paddingTop={1}>
        {isGrid ? <Text>{draw(glance, w - 3)}</Text> : line(glance)}
        {frame('Edits', 'suggestion', editRows, more > 0 ? `+${more} more` : '')}
        {tree ? frame('Working tree', tree.files.some(f => !touched.has(`${tree.root}/${f.path}`)) ? 'warning' : 'success', gitRows, `${tree.files.length} changed`) : null}
      </Box>
    )
  })
}
