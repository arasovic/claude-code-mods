import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { fileName, handoff, summaryOf } from '../hooks/register'

const msg = (text: string, handle?: string) => ({ role: 'user' as const, text, toolUses: [], handle })

test('the summary is the message the compaction wrote, not one it kept', () => {
  const before = [msg('old question', 'h1'), msg('old answer', 'h2'), msg('latest', 'h3')]
  expect(summaryOf(before, [msg('This session is being continued… summary'), msg('latest', 'h3')])).toBe('This session is being continued… summary')
  expect(summaryOf(before, [msg('latest', 'h3')])).toBe('latest')
  expect(summaryOf(before, [])).toBe('')
})

test('file name and handoff layout', () => {
  const at = new Date(2026, 9, 2, 10, 7).getTime()
  expect(fileName(at, '/Users/a/Projects/my app', 'abcdef12-3456')).toBe('2026-10-02-1007-my-app-abcdef12.md')
  const text = handoff({ at, cwd: '/Users/a/Desktop', sessionId: 'abc', trigger: 'manual', tokensBefore: 193_000, tokensAfter: 12_400, files: ['/a/b.ts'], summary: '  Did things.  ' })
  expect(text).toContain('- Compacted: 2026-10-02 10:07 (manual), 193k → 12k tokens')
  expect(text).toContain('`claude --resume abc`')
  expect(text).toContain('- /a/b.ts')
  expect(text.endsWith('## Summary\n\nDid things.\n')).toBe(true)
})

test('only a main-thread compaction that ran writes a handoff', async ($, on) => {
  mock.env(on, { HOME: '/home/a' })
  // The hook reads the clock first, so a guard that fails shows here even when a later throw stops the write.
  let clockReads = 0
  on('clock.now', () => (clockReads++, { value: 0 }))
  const writes: string[] = []
  on('fs.write', (_$, e) => (writes.push(e.path), { value: undefined }))
  on('session.cwd', () => ({ value: '/x' }))
  on('session.id', () => ({ value: 'abcdef12' }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.compact', (_$, e) => (e.instructions === 'skip' ? { skip: 'vetoed' } : { messages: [msg('summary')] }))
  const messages = [msg('old', 'h1')]

  await $.session.compact({ trigger: 'auto', instructions: 'skip', messages })
  await $.session.compact({ trigger: 'precompute', messages })
  await $.session.compact({ trigger: 'auto', agentId: 'sub', messages })
  expect(clockReads).toBe(0)
  expect(writes).toEqual([])

  await $.session.compact({ trigger: 'auto', messages })
  expect(writes).toHaveLength(1)
})

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

// The engine beneath, with the conversation's first row, which a compaction replaces.
function engine(...[$, on]: Parameters<TestBody>) {
  mock.env(on, { HOME: '/home/a' })
  on('clock.now', () => ({ value: 0 }))
  const writes: string[] = []
  on('fs.write', (_$, e) => (writes.push(e.text), { value: undefined }))
  on('session.cwd', () => ({ value: '/x' }))
  on('session.id', () => ({ value: 'abcdef12' }))
  on('ui.toast', () => ({ value: undefined }))
  let first = 'hello'
  // A compaction replaces the request's first message; the rows form keeps the old one.
  on('session.messages', (_$, e) => (e.as === 'api' ? { value: [{ role: 'user' as const, content: [{ type: 'text', text: first }] }] } : { value: [msg('hello')] }))
  on('command.run', () => ({ text: '' }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  const turn = (agentId?: string) => $.turn.complete({ answer: '', durationMs: 0, isAborted: false, reason: 'answer', turnId: 't', ...(agentId ? { agentId } : {}) })
  return { writes, turn, compact: (summary: string) => void (first = summary) }
}

test('where session.compact never runs, a compaction is saved once the conversation shows it', async ($, on) => {
  const s = engine($, on)
  await s.turn()
  expect(s.writes).toEqual([])

  s.compact('summary one')
  await $.command.run({ ...RUN, command: 'compact', args: ' keep the plan ' })
  expect(s.writes).toHaveLength(1)
  expect(s.writes[0]).toContain('(manual)')
  expect(s.writes[0]).toContain('- Instructions: keep the plan')
  expect(s.writes[0]).toContain('## Summary\n\nsummary one')
  await s.turn()
  expect(s.writes).toHaveLength(1)

  s.compact('summary two')
  await s.turn('sub')
  expect(s.writes).toHaveLength(1)
  await s.turn()
  expect(s.writes[1]).toContain('(auto or plugin)')

  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  s.compact('first prompt after /clear')
  await s.turn()
  expect(s.writes).toHaveLength(2)
})

test('a compaction session.compact saved is not saved again by the late check', async ($, on) => {
  const s = engine($, on)
  on('session.compact', () => ({ messages: [msg('summary')] }))
  await s.turn()
  s.compact('summary')
  await $.session.compact({ trigger: 'auto', messages: [msg('old', 'h1')] })
  await s.turn()
  expect(s.writes).toHaveLength(1)
})
