import { atom, read, update } from 'claude-code'
import type { Register, SessionMessage } from 'claude-code'

// Paths edited since the last compaction, listed in the next handoff.
const edited = atom({ plugin: 'compact-keeper', key: 'edited' } as const, [] as string[])

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const fileName = (at: number, cwd: string, sessionId: string) => {
  const d = new Date(at)
  const project = (cwd.split('/').filter(Boolean).pop() ?? 'root').replace(/[^\w.-]+/g, '-')
  return `${stamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}-${project}-${sessionId.slice(0, 8)}.md`
}

// The summary is the message core wrote: the one carrying no handle from the transcript it replaced.
export const summaryOf = (before: readonly SessionMessage[], after: readonly SessionMessage[]) => {
  const kept = new Set(before.map(m => m.handle).filter(Boolean))
  return (after.find(m => m.text && !(m.handle && kept.has(m.handle))) ?? after[0])?.text ?? ''
}

export const handoff = (h: { at: number; cwd: string; sessionId: string; trigger: string; instructions?: string; tokensBefore?: number; tokensAfter?: number; files: readonly string[]; summary: string }) => {
  const d = new Date(h.at)
  const size = h.tokensBefore === undefined ? '' : `, ${Math.round(h.tokensBefore / 1000)}k → ${h.tokensAfter === undefined ? '?' : Math.round(h.tokensAfter / 1000)}k tokens`
  return [
    `# Handoff: ${h.cwd.split('/').filter(Boolean).pop() ?? h.cwd}`,
    '',
    // toTimeString starts with the local HH:MM:SS.
    `- Compacted: ${stamp(d)} ${d.toTimeString().slice(0, 5)} (${h.trigger})${size}`,
    `- Directory: ${h.cwd}`,
    `- Session: ${h.sessionId} (\`claude --resume ${h.sessionId}\`)`,
    ...(h.instructions ? [`- Instructions: ${h.instructions}`] : []),
    '',
    '## Files edited before this compaction',
    '',
    ...(h.files.length ? h.files.map(f => `- ${f}`) : ['- none']),
    '',
    '## Summary',
    '',
    h.summary.trim(),
    '',
  ].join('\n')
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if ((e.tool === 'Edit' || e.tool === 'Write') && result.deny === undefined && !result.isError) {
      const path = (e as unknown as { file_path: string }).file_path
      await update($, edited, list => [path, ...list.filter(p => p !== path)].slice(0, 100))
    }
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    // A precompute may never be installed, and a subagent's compaction is not the conversation's.
    if (result.skip !== undefined || e.trigger === 'precompute' || e.agentId !== undefined) return result
    try {
      const at = await $.clock.now()
      const cwd = await $.session.cwd()
      const sessionId = await $.session.id()
      const home = await $.env.get('HOME')
      const files = await read($, edited)
      const path = `${home ?? '.'}/.claude/handoffs/${fileName(at, cwd, sessionId)}`
      await $.fs.write(path, handoff({ at, cwd, sessionId, trigger: e.trigger, instructions: e.instructions, tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter, files, summary: summaryOf(e.messages, result.messages) }))
      await update($, edited, () => [])
      $.ui.toast(`Handoff saved: ${path.replace(home ?? '\0', '~')}`)
    } catch {
      // Saving is a convenience: a failed write must never undo the compaction.
    }
    return result
  })
}
