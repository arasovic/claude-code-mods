import { expect, test, type Engine } from 'claude-code/testing'

import { forbiddenReason } from '../hooks/register'

const ALL_ON = { cfWrites: true, attribution: true, claudeBranches: true }

test('forbidden commands', () => {
  const reason = (command: string) => forbiddenReason(command, ALL_ON)
  expect(reason('cf deploy')).toBeDefined()
  expect(reason('git commit -m "fix\n\nCo-Authored-By: Claude <x@y>"')).toBeDefined()
  expect(reason('gh pr create --body "Generated with [Claude Code](https://claude.com)"')).toBeDefined()
  expect(reason('git checkout -b claude/fix-x')).toBeDefined()
  expect(reason('git push origin HEAD:claude/x')).toBeDefined()
  expect(reason('git push origin HEAD:refs/heads/claude/x')).toBeDefined()
  expect(reason('git push origin +claude/x')).toBeDefined()
  expect(reason('git commit -m "fix: typo"')).toBeUndefined()
  expect(reason('git checkout -b fix/claude-x')).toBeUndefined()
  expect(reason('git push origin HEAD:fix/claude-x')).toBeUndefined()
  expect(reason('grep -r "Co-Authored-By" .')).toBeUndefined()
})

test('each rule blocks only when its option is on', () => {
  const commands = ['cf deploy', 'git commit -m "x\n\nCo-Authored-By: Claude <x@y>"', 'git switch -c claude/x']
  expect(commands.map(c => forbiddenReason(c, {}))).toEqual([undefined, undefined, undefined])
  expect(commands.map(c => forbiddenReason(c, { cfWrites: true }) !== undefined)).toEqual([true, false, false])
  expect(commands.map(c => forbiddenReason(c, { attribution: true }) !== undefined)).toEqual([false, true, false])
  expect(commands.map(c => forbiddenReason(c, { claudeBranches: true }) !== undefined)).toEqual([false, false, true])
})

const isDenied = async ($: Engine, command: string) => {
  const r = await $.tool.call({ tool: 'Bash', command })
  return r.deny !== undefined || r.isError === true
}

test('hook denies forbidden calls, lets the rest run', { options: ALL_ON }, async ($, on) => {
  on('tool.call', () => ({ result: { stdout: 'ran' } }) as never)

  expect(await isDenied($, 'cf deploy')).toBe(true)
  expect(await isDenied($, 'git switch -c claude/x')).toBe(true)
  expect(await isDenied($, 'rm -rf build')).toBe(false)
  expect(await isDenied($, 'wrangler deploy')).toBe(false)
  expect(await isDenied($, 'ls')).toBe(false)
})

test('with the defaults the hook blocks nothing', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: 'ran' } }) as never)

  expect(await isDenied($, 'cf deploy')).toBe(false)
  expect(await isDenied($, 'git switch -c claude/x')).toBe(false)
})
