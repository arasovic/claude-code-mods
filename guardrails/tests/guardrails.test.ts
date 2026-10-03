import { expect, test } from 'claude-code/testing'

import { forbiddenReason } from '../hooks/register'

test('forbidden commands', () => {
  expect(forbiddenReason('cf deploy')).toBeDefined()
  expect(forbiddenReason('git commit -m "fix\n\nCo-Authored-By: Claude <x@y>"')).toBeDefined()
  expect(forbiddenReason('gh pr create --body "Generated with [Claude Code](https://claude.com)"')).toBeDefined()
  expect(forbiddenReason('git checkout -b claude/fix-x')).toBeDefined()
  expect(forbiddenReason('git push origin HEAD:claude/x')).toBeDefined()
  expect(forbiddenReason('git push origin HEAD:refs/heads/claude/x')).toBeDefined()
  expect(forbiddenReason('git push origin +claude/x')).toBeDefined()
  expect(forbiddenReason('git commit -m "fix: typo"')).toBeUndefined()
  expect(forbiddenReason('git checkout -b fix/claude-x')).toBeUndefined()
  expect(forbiddenReason('git push origin HEAD:fix/claude-x')).toBeUndefined()
  expect(forbiddenReason('grep -r "Co-Authored-By" .')).toBeUndefined()
})

test('hook denies forbidden calls, lets the rest run', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: 'ran' } }) as never)

  const isDenied = async (command: string) => {
    const r = await $.tool.call({ tool: 'Bash', command })
    return r.deny !== undefined || r.isError === true
  }

  expect(await isDenied('cf deploy')).toBe(true)
  expect(await isDenied('git switch -c claude/x')).toBe(true)
  expect(await isDenied('rm -rf build')).toBe(false)
  expect(await isDenied('wrangler deploy')).toBe(false)
  expect(await isDenied('ls')).toBe(false)
})
