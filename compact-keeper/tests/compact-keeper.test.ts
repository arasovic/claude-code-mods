import { expect, test } from 'claude-code/testing'

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
