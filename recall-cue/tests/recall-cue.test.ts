import type { FsEntry, PromptOrigin } from 'claude-code'
import { expect, mock, test, type TestBody } from 'claude-code/testing'

const MEMORY = '/Users/me/.claude/projects/p/memory'
const NOTES = '/Users/me/notes'
const entry = (name: string, kind: FsEntry['kind'] = 'file', isLink = false): FsEntry => ({ name, kind, size: 0, mtimeMs: 1, isLink })
const TREE: Record<string, FsEntry[]> = {
  [MEMORY]: [entry('MEMORY.md'), entry('book-club.md'), entry('backup-job.md'), entry('release-flow.md')],
  [NOTES]: [entry('INDEX.md'), entry('garden', 'dir'), entry('.trash', 'dir'), entry('loop', 'other', true), entry('shared.md', 'other', true)],
  [`${NOTES}/garden`]: [entry('tomatoes.md')],
}
const FILES: Record<string, string> = {
  [`${MEMORY}/MEMORY.md`]: '- [Book club](book-club.md) — reading list and meeting dates\n- [Backup job](backup-job.md) — what to do after an outage',
  [`${MEMORY}/book-club.md`]: '---\nname: book-club\ndescription: "Reading list and \\"meeting\\" dates for the book club"\n---\nNext one on Friday.',
  [`${MEMORY}/backup-job.md`]: '---\nname: backup-job\ndescription: Restart the backup job after a power cut\n---\n',
  [`${MEMORY}/release-flow.md`]: '---\nname: release-flow\ndescription: Bump the version, then tag\n---\n',
  [`${NOTES}/INDEX.md`]: '# Notes\n- [Tomatoes](garden/tomatoes.md): planting and watering schedule\n',
  [`${NOTES}/garden/tomatoes.md`]: '# Tomatoes\nWater every second day.',
  [`${NOTES}/shared.md`]: '# Shared\n',
}

// A home with an auto-memory folder and a notes folder; each submit answers the context the hooks attached.
function setUp(...[$, on]: Parameters<TestBody>) {
  const lists: string[] = []
  const reads: string[] = []
  mock.env(on, { HOME: '/Users/me' })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 20, breakdown: { memoryFiles: [{ path: `${MEMORY}/MEMORY.md`, type: 'AutoMem', tokens: 90 }] } }, rateLimits: [] },
  }) as never)
  on('fs.list', (_$, e) => (lists.push(e.path), TREE[e.path] ? { value: TREE[e.path]! } : { deny: 'ENOENT' }))
  on('fs.stat', (_$, e) => (e.path in FILES ? { value: { kind: 'file' as const, size: 0, mtimeMs: 1, isLink: true } } : { deny: 'ENOENT' }))
  on('fs.read', (_$, e) => (reads.push(e.path), e.path in FILES ? { value: FILES[e.path]! } : { deny: 'ENOENT' }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  const submit = async (text: string, origin: PromptOrigin = { kind: 'composer' }, extra = {}) =>
    (await $.prompt.submit({ text, wait: false, origin, ...extra })).context
  return { lists, reads, submit }
}

test('a prompt that fits a memory note hints it once per session', async ($, on) => {
  const { reads, submit } = setUp($, on)

  expect(await submit('any news on the reading list for the book club?')).toEqual([
    `recall-cue: an automatic note the user does not see. These saved notes may fit this prompt. Read one before you act when its description fits, and skip it when it does not. If a note changes what you do, name it in one short line.\n- ${MEMORY}/book-club.md: Reading list and "meeting" dates for the book club`,
  ])
  const read = reads.length
  expect(await submit('any news on the reading list for the book club?')).toBeUndefined()
  // Files whose time did not change are not read again.
  expect(reads).toHaveLength(read)
  expect(await submit('make me a coffee')).toBeUndefined()
  // One shared word is not enough.
  expect(await submit('restart the dev server')).toBeUndefined()

  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect((await submit('reading list for the book club', { kind: 'sdk' }))?.[0]).toContain('book-club.md')
})

test('commands, hidden prompts and other plugins get no hint', async (...args) => {
  const { submit } = setUp(...args)
  const text = 'reading list for the book club'
  expect(await submit(text, { kind: 'composer' }, { command: { name: 'review', args: text } })).toBeUndefined()
  expect(await submit(text, { kind: 'composer' }, { isMeta: true })).toBeUndefined()
  expect(await submit(text, { kind: 'plugin', name: 'other' } as never)).toBeUndefined()
  // Without extraFolders only the memory folder is read.
  expect(await submit('when should I water the tomatoes?')).toBeUndefined()
})

test('extraFolders adds a notes folder, and an index line says what a note is about', { options: { extraFolders: ' ~/notes/ , ' } }, async (...args) => {
  const { lists, reads, submit } = setUp(...args)
  expect((await submit('when should I water the tomatoes?'))?.[0]).toContain(`- ${NOTES}/garden/tomatoes.md: Tomatoes planting and watering schedule`)
  // A linked file is read; a linked folder and a dot folder are not entered.
  expect(reads).toContain(`${NOTES}/shared.md`)
  expect(lists).not.toContain(`${NOTES}/loop`)
  expect(lists).not.toContain(`${NOTES}/.trash`)
})
