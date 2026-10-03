import { expect, test } from 'claude-code/testing'

import { isSearch, outcome, statusText, webFound } from '../hooks/register'

test('search commands are told apart from other commands', () => {
  for (const c of ['grep -rn foo src', 'rg "x" app', 'cd src && find . -name "*.ts"', 'ls | grep foo', '/usr/bin/grep -n x a.ts',
    'git grep -n todo', 'fd test', 'git ls-files | xargs grep -l foo'])
    expect(isSearch(c)).toBe(true)
  for (const c of ['ls -la', 'git status', 'npm run find-deps', 'echo grep', 'cat findings.md'])
    expect(isSearch(c)).toBe(false)
})

test('a find right after a miss took several tries', () => {
  expect(outcome(true, undefined)).toBe('fast')
  expect(outcome(true, 'fast')).toBe('fast')
  expect(outcome(true, 'miss')).toBe('slow')
  expect(outcome(true, 'slow')).toBe('fast')
  expect(outcome(false, 'miss')).toBe('miss')
  expect(webFound(['no results', { tool_use_id: 'a', content: [] }])).toBe(false)
  expect(webFound([{ tool_use_id: 'a', content: [{ title: 't', url: 'https://x.test' }] }])).toBe(true)
})

test('the status line counts each color and shows the last searches', () => {
  expect(statusText([])).toBeUndefined()
  expect(statusText(['fast', 'miss', 'fast', 'slow', 'fast', 'fast', 'miss'])).toBe('🔍 🟢 4 🟡 1 🔴 2 · last 🟢🟡🟢🟢🔴')
})
