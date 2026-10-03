import { expect, test, type TestBody } from 'claude-code/testing'

import { callKey, NOTE } from '../hooks/register'

const FAIL = 'exit 1: no such file'

// A Bash tool that is refused while `state.deny`, fails with `state.error`, or succeeds while it is empty; and the toasts shown.
function setup(...[$, on]: Parameters<TestBody>) {
  const state = { deny: false, error: FAIL, toasts: [] as string[] }
  on('tool.call', () =>
    state.deny ? { deny: 'not allowed' } : state.error ? { isError: true, result: state.error, text: state.error } : { result: { stdout: 'ok', stderr: '', interrupted: false } })
  on('ui.toast', (_$, e) => (state.toasts.push(e.text), { value: undefined }))
  const run = async (command: string, description?: string) => (await $.tool.call({ tool: 'Bash', command, description })).context
  return { state, run }
}

test('the second identical failure carries the note once, and a success clears it', async ($, on) => {
  const { state, run } = setup($, on)

  expect(await run('cat a.txt', 'Read a')).toBeUndefined()
  // The model words the description anew on a retry; the call is still the same.
  expect(await run('cat a.txt', 'Read a again')).toEqual([NOTE])
  expect(state.toasts).toEqual(['the same Bash call failed twice; Claude was told to change approach'])
  expect(await run('cat a.txt')).toBeUndefined()
  expect(await run('cat b.txt')).toBeUndefined()
  expect(state.toasts).toHaveLength(1)

  state.error = ''
  await run('cat a.txt')
  state.error = FAIL
  expect(await run('cat a.txt')).toBeUndefined()
  expect(await run('cat a.txt')).toEqual([NOTE])
  expect(state.toasts).toHaveLength(2)
})

test('a rerun that fails differently is not a loop', async ($, on) => {
  const { state, run } = setup($, on)
  state.error = '3 tests failed'
  await run('npm test')
  state.error = '1 test failed'
  expect(await run('npm test')).toBeUndefined()
  // A, B, A: the second error replaced the first, so the third is new again.
  state.error = '3 tests failed'
  expect(await run('npm test')).toBeUndefined()
})

test('an interrupted turn and a new session forget the failures', async ($, on) => {
  const { run } = setup($, on)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))

  await run('sleep 30')
  await $.turn.complete({ answer: '', durationMs: 1_000, isAborted: true, reason: 'aborted', turnId: 't' })
  expect(await run('sleep 30')).toBeUndefined()

  await $.turn.complete({ answer: 'done', durationMs: 1_000, isAborted: false, reason: 'answer', turnId: 't' })
  expect(await run('sleep 30')).toEqual([NOTE])

  await run('cat c.txt')
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(await run('cat c.txt')).toBeUndefined()
})

test('a refused call neither counts as a failure nor clears one', async ($, on) => {
  const { state, run } = setup($, on)
  await run('rm -rf build')
  state.deny = true
  expect(await run('rm -rf build')).toBeUndefined()
  state.deny = false
  expect(await run('rm -rf build')).toEqual([NOTE])
})

test('a subagent call is not the main thread call, whatever the description says', () => {
  const call = { tool: 'Bash', command: 'cat a.txt' }
  expect(callKey({ ...call, tool_use_id: '1', description: 'x' })).toBe(callKey({ ...call, tool_use_id: '2', description: 'y' }))
  expect(callKey({ ...call, agentId: 'a1' })).not.toBe(callKey(call))
})
