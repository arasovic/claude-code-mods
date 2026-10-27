import type { EngineInterface, Register } from 'claude-code'

export type Note = { path: string; about: string; words: Set<string> }
export type NoteFile = { path: string; rel: string; text: string }

const INDEX = /[\\/]MEMORY\.md$/
const MAX_HINTS = 2
const MAX_FILES = 2000
// shortcut: one fixed bar, tuned on a 15-note memory folder and a 150-note notes folder; make it an option if hints come too often or too rarely elsewhere.
const MIN_SCORE = 1.2
// Typed at the terminal, over Remote Control, or in an SDK host such as the desktop app, which runs Claude Code headless.
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
// The memory folder lookup stops after this many prompts find no auto-memory index, so a session with memory off stops paying for it.
const MAX_MISSES = 3

// Turkish and English fold to one alphabet, so "şarkı" matches a file named "sarki" and "İstanbul" matches "istanbul".
function fold(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase()
}

const STOP = new Set(
  ('an as at be by do go if in is it me my no of on or so to up us we the and for with this that from into what when where which your you are was were have has '
    + 'had not but can will would should could about then them they there here also only just more most some such than very does did how why who its our all any one '
    + 'md ve bu şu o da de ki mi mı mu mü ne ya bir için ile gibi daha sonra ama veya nasıl neden niye çok var yok olan olsun olarak kadar ben sen biz siz onu bunu '
    + 'şunu her hiç zaman şey yeni eski tüm son ilk hangi nerede şimdi artık yine bile').split(' ').map(fold),
)

export const words = (text: string) => new Set(fold(text).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2 && !STOP.has(w)))

// Pasted logs and code name many things the request is not about. A quoted line is mostly the model's own earlier answer,
// and a comment is markup the app adds, such as the desktop's "<!-- reply 1 -->".
const strip = (text: string) =>
  text.replace(/<pasted_content\b[\s\S]*?<\/pasted_content[^>]*>/g, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/^[ \t]*>.*$/gm, ' ')

// A shared stem counts too, for suffixes: "dosya" and "dosyası", "compact" and "compaction".
const near = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))

// `target` as seen from the file at `from`, with `.` and `..` resolved.
function resolve(from: string, target: string) {
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return `${target.startsWith('/') ? '/' : ''}${parts.join('/')}`.replace(/^\/\//, '/')
}

// A note is known by its path, its frontmatter `name` and `description`, and the list items in other notes that open with a link to it,
// such as its line in a MEMORY.md or INDEX.md. Without a description, its first such item or its first heading says what it is about.
export function build(files: NoteFile[]): Note[] {
  const linked = new Map<string, string[]>()
  for (const file of files) {
    for (const [, label, target, rest] of file.text.matchAll(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+\[([^\]\n]*)\]\(([^)\s]+\.md)\)([^\n]*)/gm)) {
      if (/^[a-z]+:/i.test(target!)) continue
      // The head of an item says what the note is; a long tail would make the note match every prompt.
      const line = `${label} ${rest!.replace(/^[\s:—–-]+/, '')}`.trim().slice(0, 200)
      const to = resolve(file.path, target!)
      linked.set(to, [...(linked.get(to) ?? []), line])
    }
  }
  return files.filter(file => !INDEX.test(file.path)).map(file => {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(file.text)?.[1] ?? ''
    const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(front)?.[1]?.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, (_, text: string) => text.replace(/\\(.)/g, '$1'))
    const lines = linked.get(file.path) ?? []
    const about = field('description') ?? lines[0] ?? /^#[ \t]+(.+)$/m.exec(file.text)?.[1]?.trim() ?? ''
    return { path: file.path, about, words: words([file.rel.replace(/\.md$/, ''), field('name'), about, ...lines].join(' ')) }
  })
}

// Each note with the prompt words it shares, each word weighted by how few notes it matches, best first.
export function rank(prompt: string, notes: Note[]) {
  // The notes each prompt word matches, by a shared stem too, so "session" stays common when one note holds "sessionmode".
  const asked = [...words(strip(prompt))].map(a => new Set(notes.filter(note => [...note.words].some(w => near(a, w)))))
  // 1 for a word only one note matches, 0 for a word every note matches, so the bar means the same for 15 notes and for 1,500.
  const weight = (held: Set<Note>) => Math.log(notes.length / held.size) / Math.log(Math.max(notes.length, 2))
  return notes
    .map(note => {
      const hits = asked.filter(held => held.has(note)).map(weight).filter(score => score > 0)
      return { note, count: hits.length, score: hits.reduce((sum, score) => sum + score, 0) }
    })
    .sort((a, b) => b.score - a.score)
}

export const pick = (prompt: string, notes: Note[], skip: ReadonlySet<string>) =>
  rank(prompt, notes).filter(r => r.count >= 2 && r.score >= MIN_SCORE && !skip.has(r.note.path)).slice(0, MAX_HINTS).map(r => r.note)

export const hint = (notes: Note[]) => [
  'recall-cue: an automatic note the user does not see. These saved notes may fit this prompt. Read one before you act when its description fits, and skip it when it does not. If a note changes what you do, name it in one short line.',
  ...notes.map(n => `- ${n.path}${n.about ? `: ${n.about}` : ''}`),
].join('\n')

// Markdown files under `dir` with their times. A linked file counts; a linked folder is not entered, so a loop cannot form.
async function walk($: EngineInterface, dir: string, out: Map<string, number>) {
  for (const entry of await $.fs.list(dir).catch(() => [])) {
    if (out.size >= MAX_FILES || entry.name.startsWith('.')) continue
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir') await walk($, path, out)
    else if (!entry.name.endsWith('.md')) continue
    else if (!entry.isLink) out.set(path, entry.mtimeMs)
    else {
      const stat = await $.fs.stat(path).catch(() => undefined)
      if (stat?.kind === 'file') out.set(path, stat.mtimeMs)
    }
  }
}

// What a session keeps between prompts. Files by path, read again when their time changes.
type State = { extra: string[]; cache: Map<string, { mtimeMs: number; file: NoteFile }>; roots?: string[]; memory: string; misses: number }

async function folders($: EngineInterface, s: State) {
  if (!s.memory && s.misses < MAX_MISSES) {
    const files = (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.memoryFiles ?? []
    const index = files.find(file => file.type === 'AutoMem' && INDEX.test(file.path))?.path
    if (index) s.memory = index.replace(INDEX, '')
    else s.misses++
  }
  if (!s.roots) {
    const home = (await $.env.get('HOME')) ?? ''
    s.roots = s.extra.map(dir => dir.replace(/^~(?=$|[\\/])/, home))
  }
  return [...new Set([s.memory, ...s.roots].filter(Boolean))]
}

async function notes($: EngineInterface, s: State) {
  const files: NoteFile[] = []
  for (const root of await folders($, s)) {
    const found = new Map<string, number>()
    await walk($, root, found)
    for (const [path, mtimeMs] of found) {
      let cached = s.cache.get(path)
      if (cached?.mtimeMs !== mtimeMs) {
        cached = { mtimeMs, file: { path, rel: path.slice(root.length + 1), text: await $.fs.read(path).catch(() => '') } }
        s.cache.set(path, cached)
      }
      files.push(cached.file)
    }
  }
  return build(files)
}

export const register: Register = (on, options) => {
  const extra = String(options.extraFolders ?? '').split(',').map(dir => dir.trim().replace(/[\\/]+$/, '')).filter(Boolean)
  const state: State = { extra, cache: new Map(), memory: '', misses: 0 }
  const hinted = new Set<string>()

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !USER_ORIGINS.has(e.origin.kind)) return next(e)
    let picked: Note[] = []
    try {
      picked = pick(e.text, await notes($, state), hinted)
    } catch {
      // Hints are best effort: the prompt goes through either way.
    }
    if (picked.length === 0) return next(e)
    for (const note of picked) hinted.add(note.path)
    return next({ ...e, context: [...(e.context ?? []), hint(picked)] })
  })

  // A note is hinted once per session; /clear starts a new one.
  on('session.end', async ($, e, next) => (hinted.clear(), next(e)))
}
