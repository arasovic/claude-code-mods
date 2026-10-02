import { expect, test } from 'claude-code/testing'

import { isSearch, outcome, SLOW_MS, statusText, webFound } from '../hooks/register'

test('search commands are told apart from other commands', () => {
  for (const c of ['grep -rn foo src', 'rg "x" app', 'cd src && find . -name "*.ts"', 'ls | grep foo', '/usr/bin/grep -n x a.ts',
    'git grep -n todo', 'fd test', 'git ls-files | xargs grep -l foo'])
    expect(isSearch(c)).toBe(true)
  for (const c of ['ls -la', 'git status', 'npm run find-deps', 'echo grep', 'cat findings.md'])
    expect(isSearch(c)).toBe(false)
})

test('each search is fast, slow or found nothing', () => {
  expect(outcome(true, 100, SLOW_MS.Bash)).toBe('fast')
  expect(outcome(true, 4_000, SLOW_MS.Bash)).toBe('slow')
  expect(outcome(true, 4_000, SLOW_MS.WebSearch)).toBe('fast')
  expect(outcome(false, 50, SLOW_MS.Bash)).toBe('miss')
  expect(webFound(['no results', { tool_use_id: 'a', content: [] }])).toBe(false)
  expect(webFound([{ tool_use_id: 'a', content: [{ title: 't', url: 'https://x.test' }] }])).toBe(true)
})

test('the status line counts each color and shows the last searches', () => {
  expect(statusText([])).toBeUndefined()
  expect(statusText(['fast', 'miss', 'fast', 'slow', 'fast', 'fast', 'miss'])).toBe('🔍 🟢 4 🟡 1 🔴 2 · last 🟢🟡🟢🟢🔴')
})
