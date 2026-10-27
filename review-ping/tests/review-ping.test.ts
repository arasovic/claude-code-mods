import { expect, test, type TestBody } from 'claude-code/testing'

import { committed, note } from '../hooks/register'

const BIG = '[main 1a2b3c4] Add the parser\n 2 files changed, 31 insertions(+), 4 deletions(-)\n'
const SMALL = '[main 5d6e7f8] Fix a typo\n 1 file changed, 1 insertion(+), 1 deletion(-)\n'

// Bash prints `state.stdout`; every other tool succeeds. The toasts shown.
function setup(...[$, on]: Parameters<TestBody>) {
  const state = { stdout: BIG, toasts: [] as string[] }
  on('tool.call', (_$, e) => ({ result: e.tool === 'Bash' ? { stdout: state.stdout, stderr: '', interrupted: false } : { success: true } }) as never)
  on('ui.toast', (_$, e) => (state.toasts.push(e.text), { value: undefined }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  // agentId is not in every build's Bash input type, but it reaches the hook.
  const run = async (command = 'git commit -m "Add the parser"', agentId?: string) => (await $.tool.call({ tool: 'Bash', command, agentId } as never)).context
  const skill = (name: string) => $.tool.call({ tool: 'Skill', skill: name })
  return { state, run, skill }
}

test('a big commit with no review gets the note, a small one does not', async ($, on) => {
  const { state, run } = setup($, on)
  expect(await run()).toEqual([note('1a2b3c4', 35)])
  expect(state.toasts).toEqual(['commit 1a2b3c4 changed 35 lines with no review; Claude was asked to review it'])
  state.stdout = SMALL
  expect(await run()).toBeUndefined()
  expect(state.toasts).toHaveLength(1)
})

test('a review skill, a reviewer agent or a typed /code-review covers the next commit only', async ($, on) => {
  const { run, skill } = setup($, on)
  await skill('code-review')
  expect(await run()).toBeUndefined()

  await $.tool.call({ tool: 'Agent', description: 'Review', prompt: 'Review the diff', subagent_type: 'feature-dev:code-reviewer' })
  expect(await run()).toBeUndefined()

  await $.prompt.submit({ text: '/code-review', wait: false, origin: { kind: 'composer' }, command: { name: 'code-review', args: '' } })
  expect(await run()).toBeUndefined()

  // The last review was spent, and a skill that is not a review does not count.
  await skill('pdf')
  expect(await run()).toEqual([note('1a2b3c4', 35)])
})

test('a review after a note answers that note and does not cover the next commit', async ($, on) => {
  const { state, run, skill } = setup($, on)
  expect(await run()).toEqual([note('1a2b3c4', 35)])
  await skill('code-review')
  expect(await run()).toEqual([note('1a2b3c4', 35)])

  // Once the note is answered, the next review covers the next commit again.
  await skill('code-review')
  await skill('code-review')
  expect(await run()).toBeUndefined()

  // A note nobody answered waits only until the next commit.
  expect(await run()).toEqual([note('1a2b3c4', 35)])
  state.stdout = SMALL
  await run()
  state.stdout = BIG
  await skill('code-review')
  expect(await run()).toBeUndefined()
})

test('other commands, quiet commits and subagent commits get no note', async ($, on) => {
  const { state, run } = setup($, on)
  expect(await run('git log -1')).toBeUndefined()
  expect(await run('cat release-notes.txt')).toBeUndefined()
  expect(await run('git commit -m "x"', 'a1')).toBeUndefined()
  state.stdout = ''
  expect(await run('git commit -q -m "x"')).toBeUndefined()
  expect(state.toasts).toHaveLength(0)
})

test('a new session forgets a review and a waiting note', async ($, on) => {
  const { run, skill } = setup($, on)
  await skill('code-review')
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(await run()).toEqual([note('1a2b3c4', 35)])

  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  await skill('code-review')
  expect(await run()).toBeUndefined()
})

test('the hash and the line count come from git commit output', () => {
  expect(committed('[main (root-commit) abcdef1] Init\n 3 files changed, 40 insertions(+)\n')).toEqual({ sha: 'abcdef1', lines: 40 })
  // Two commits in one call: the last hash, both counts.
  expect(committed('[detached HEAD 1234abc] A\n 1 file changed, 2 deletions(-)\n[detached HEAD 5678def] B\n 1 file changed, 3 insertions(+)\n')).toEqual({ sha: '5678def', lines: 5 })
  expect(committed('nothing to commit, working tree clean\n')).toBeUndefined()
})
