import { expect, test } from 'claude-code/testing'

import { NOTE } from '../hooks/register'

test('the second identical failure carries the note, and a success clears it', async ($, on) => {
  let error = 'exit 1: no such file'
  on('tool.call', () => (error ? { isError: true, result: error, text: error } : { result: { stdout: 'ok', stderr: '', interrupted: false } }))
  const run = (command: string, description?: string) => $.tool.call({ tool: 'Bash', command, description })

  expect((await run('cat a.txt', 'Read a')).context).toBeUndefined()
  // The model words the description anew on a retry; the call is still the same.
  expect((await run('cat a.txt', 'Read a again')).context).toEqual([NOTE])
  expect((await run('cat b.txt')).context).toBeUndefined()

  error = ''
  await run('cat a.txt')
  error = 'exit 1: no such file'
  expect((await run('cat a.txt')).context).toBeUndefined()
})

test('a rerun that fails differently is not a loop', async ($, on) => {
  let n = 0
  on('tool.call', () => ({ isError: true, result: `${++n} tests failed`, text: `${n} tests failed` }))
  expect((await $.tool.call({ tool: 'Bash', command: 'npm test' })).context).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'npm test' })).context).toBeUndefined()
})
