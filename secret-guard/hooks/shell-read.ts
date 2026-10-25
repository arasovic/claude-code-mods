// ponytail: split on shell operators outside quotes; sh -c, eval, quoted globs, scripts the model writes and a quote left open across
// lines pass through. Output scrubbing is the net for those.
// A name right before `(` is a function call (`mock.env(on)`), not a file. Quoted text stays one segment, so `grep "(export )?"` is not
// read as `export`; `$(` and backticks still run a command inside double quotes, so they split there too.
export const commandSegments = (command: string): string[] => {
  const text = command.replace(/[\w.-]+\(/g, '(')
  const parts: string[] = []
  const resumeQuotes: ('"' | null)[] = []
  let current = ''
  let quote: '"' | "'" | "$'" | null = null
  let isBacktickInQuote = false
  const endSegment = () => {
    parts.push(current)
    current = ''
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? ''
    const pair = text.slice(index, index + 2)
    if (quote === "'") {
      if (char === "'") quote = null
      current += char
      continue
    }
    // In `$'…'` a backslash escapes the next character, so `$'it\'s'` closes on its last quote.
    if (quote === "$'") {
      if (char === "'") quote = null
      current += char === '\\' ? pair : char
      if (char === '\\') index++
      continue
    }
    if (char === '\\') {
      // A backslash-newline joins two lines into one, as bash does.
      if (pair !== '\\\n') current += pair
      index++
      continue
    }
    if (quote === '"') {
      if (pair === '$(') {
        endSegment()
        resumeQuotes.push('"')
        quote = null
        index++
      } else if (char === '`') {
        endSegment()
        isBacktickInQuote = true
        quote = null
      } else {
        if (char === '"') quote = null
        current += char
      }
      continue
    }
    if (char === '#' && /^$|[\s;&|()`<>]/.test(text[index - 1] ?? '')) {
      // A comment runs to the end of the line, so a quote in it (`# don't`) opens nothing.
      const end = text.indexOf('\n', index)
      const stop = end === -1 ? text.length : end
      current += text.slice(index, stop)
      index = stop - 1
    } else if (pair === "$'") {
      quote = "$'"
      current += pair
      index++
    } else if (char === "'" || char === '"') {
      quote = char
      current += char
    } else if (pair === '&&' || pair === '||') {
      endSegment()
      index++
    } else if (pair === '$(' || char === '(') {
      endSegment()
      resumeQuotes.push(null)
      if (pair === '$(') index++
    } else if (char === ')') {
      endSegment()
      quote = resumeQuotes.pop() ?? null
    } else if (char === '`') {
      endSegment()
      if (isBacktickInQuote) quote = '"'
      isBacktickInQuote = false
    } else if (';|\n'.includes(char)) {
      endSegment()
    } else {
      current += char
    }
  }
  endSegment()
  return parts.map(part => part.trim().replace(/^(sudo|command|exec|time|nohup)\s+/, '')).filter(Boolean)
}

// `cat` or `tee` writing a heredoc out is data, but only with a quoted delimiter: in a `<<EOF` body `$(…)` and backticks still run.
// The opener line holds that command alone, after plain `&&` steps at most, so in `echo tee; python3 - <<'EOF'` or
// `cat <<'EOF' | sh` the body is still read as commands. A step or a file name may be quoted (`cd "/my dir"`, `"$DIR/a.md"`), but
// not hold `$(` or a backtick, and a trailing `# comment` is allowed. `\x60` is a backtick, which String.raw cannot hold.
const QUOTED = String.raw`'[^']*'|"(?:[^"\x60\\$]|\$(?!\())*"`
const AND_STEP = String.raw`(?:[^<>|;&'"\x60\\()#]|${QUOTED})*`
const FILE_NAME = String.raw`(?:[^\s<>|;&'"\x60\\()#]|${QUOTED})+`
const DATA_HEREDOC = new RegExp(
  String.raw`^(?:${AND_STEP}&&)*\s*(?:cat(?:\s*>>?\s*${FILE_NAME})?|tee\s+(?:-a\s+)?${FILE_NAME})\s*<<-?\s*(['"])([\w.-]+)\1(?:\s*>>?\s*${FILE_NAME})?(?:\s+#.*)?\s*$`,
)
const HEREDOC = /(?<!<)<<(?!<)-?\s*\\?(['"]?)([\w.-]+)\1/g
// ponytail: counts brackets without reading quotes, so a stray `)` in an earlier quote can hide a group; a parser if that matters.
const isGrouped = (text: string) => (text.match(/[({]/g)?.length ?? 0) > (text.match(/[)}]/g)?.length ?? 0)

// Drops data heredoc bodies. Any other body is kept, and no line in it opens a data heredoc. Inside an open `{`, `(`, `<(` or `$(` the
// output of `cat` can go to bash (`{ cat <<'EOF' … } | bash`), so a body there is not data.
export const withoutDataHeredocs = (command: string): string => {
  const kept: string[] = []
  let endings: string[] = []
  let isDataBody = false
  for (const line of command.split('\n')) {
    if (endings.length > 0) {
      if (line.trim() === endings[0]) endings.shift()
      else if (isDataBody) continue
      // A body is not read with shell quotes: in `<<EOF` they are plain text around a running `$(…)`, and python's `'''it's'''`
      // is an odd count. So quotes and `#` there must not hide what follows.
      kept.push(line.replace(/['"#]/g, ' '))
      continue
    }
    // After a trailing `\` the line continues the one before it, so its heredoc can belong to another command.
    const opener = kept.at(-1)?.endsWith('\\') || isGrouped([...kept, line].join('\n')) ? null : DATA_HEREDOC.exec(line)
    isDataBody = opener !== null
    endings = opener ? [opener[2] ?? ''] : [...line.matchAll(HEREDOC)].map(match => match[2] ?? '')
    kept.push(line)
  }
  return kept.join('\n')
}

// Drops every heredoc body, for the file system check: a body is data or a script, not paths to look up.
export const withoutHeredocs = (command: string): string => {
  const kept: string[] = []
  let endings: string[] = []
  for (const line of command.split('\n')) {
    if (endings.length > 0) {
      if (line.trim() === endings[0]) endings.shift()
      continue
    }
    endings = [...line.matchAll(HEREDOC)].map(match => match[2] ?? '')
    kept.push(line)
  }
  return kept.join('\n')
}

// Splits a segment into the words the path check reads. Whitespace, `<`, `>` and `=` split even inside quotes,
// because a quoted string can hold a command (`bash -c "cat .env"`). Quotes are removed. A backslash outside
// quotes escapes the next character, so `\.env` is `.env`; inside single quotes it stays, so `'\.env'` is a pattern.
export const pathWords = (segment: string): string[] => {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let index = 0; index < segment.length; index++) {
    const char = segment[index] ?? ''
    const next = segment[index + 1] ?? ''
    if (/[\s<>=]/.test(char)) {
      if (current) words.push(current)
      current = ''
    } else if (quote === null && (char === "'" || char === '"')) {
      quote = char
    } else if (char === quote) {
      quote = null
    } else if (char === '\\' && (quote === null || (quote === '"' && '$`"\\'.includes(next)))) {
      current += next
      index++
    } else {
      current += char
    }
  }
  if (current) words.push(current)
  return words
}

// Splits a segment into shell words, keeping their quotes. An operator such as `<`, `2>`, `<>` or `&` is a token of its own,
// as it is in bash. Undefined when a quote is left open.
const SHELL_TOKEN = /\d*[<>&|;()]+|(?:[^\s'"\\<>&|;()]|\\[\s\S]|'[^']*'|"(?:[^"\\]|\\[\s\S])*")+/g
const OPERATOR = /^\d*[<>&|;()]/
const shellTokens = (segment: string): string[] | undefined =>
  segment.replace(SHELL_TOKEN, '').trim() === '' ? (segment.match(SHELL_TOKEN) ?? []) : undefined

// The jq options that take values, and how many.
const JQ_OPTION_VALUES = new Map([['--indent', 1], ['-L', 1], ['--arg', 2], ['--argjson', 2], ['--slurpfile', 2], ['--rawfile', 2]])

// jq reads its first argument that is not an option as a filter. None is found with `-f` (the filter comes from a file), or
// after an operator other than a redirect, such as a lone `&` that starts a second command.
const jqFilter = (segment: string): { tokens: string[]; index: number } | undefined => {
  if (!/^(\S*\/)?jq\s/.test(segment)) return undefined
  const tokens = shellTokens(segment)
  if (!tokens) return undefined
  let isOptionsEnd = false
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index] ?? ''
    if (OPERATOR.test(token)) {
      if (!/[<>]/.test(token)) return undefined
      index++
    } else if (!isOptionsEnd && token.startsWith('-')) {
      if (token === '--') isOptionsEnd = true
      else if (token === '--from-file' || /^-[a-zA-Z]*f/.test(token)) return undefined
      else index += JQ_OPTION_VALUES.get(token) ?? 0
    } else {
      return { tokens, index }
    }
  }
  return undefined
}

// A jq filter names a key, not a file (`jq '.env.PATH' settings.json`), so it is dropped and every other word is still read:
// files, option values and redirect targets. A filter that imports a module reads a JSON file, so it is kept.
export const withoutJqFilter = (segment: string): string => {
  const filter = jqFilter(segment)
  if (!filter || /\b(import|include)\b/.test(filter.tokens[filter.index] ?? '')) return segment
  return filter.tokens.filter((_, index) => index !== filter.index).join(' ')
}

// jq's `env` and `$ENV` hold the whole environment. A key (`.env`) or a string (`"env"`) of that name is not the builtin.
export const jqReadsEnvironment = (segment: string): boolean => {
  const filter = jqFilter(segment)
  const text = filter?.tokens[filter.index]?.replace(QUOTED_PART, (_, single, double) => single ?? double) ?? ''
  return /(?<![\w.$"])env\b|\$ENV\b/.test(text)
}

const SHELL_WORD = /(?:[^\s'"\\]|\\[\s\S]|'[^']*'|"(?:[^"\\]|\\[\s\S])*")+/g
const QUOTED_PART = /'([^']*)'|"((?:[^"\\]|\\[\s\S])*)"/g

// The shell words whose quotes hold whitespace, quotes removed, as one string each: `"User Data/Default/Login Data"` is
// one path, which a split on whitespace breaks up. A quoted command (`bash -c "cat 'a b/Login Data'"`) is read again for
// its own words.
export const quotedWords = (segment: string): string[] => {
  const words: string[] = []
  for (const token of segment.match(SHELL_WORD) ?? []) {
    if (!/['"]/.test(token)) continue
    const word = token.replace(QUOTED_PART, (_, single, double) => single ?? double)
    if (/\s/.test(word)) words.push(word)
    for (const [, single, double] of token.matchAll(QUOTED_PART)) words.push(...quotedWords(single ?? double ?? ''))
  }
  return words
}

// The words of a segment with no quote or backslash, split as pathWords splits them. Only in these does the shell expand
// `*`, `?`, `[` and `{a,b}`.
export const unquotedWords = (segment: string): Set<string> =>
  new Set((segment.match(SHELL_WORD) ?? []).filter(token => !/['"\\]/.test(token)).flatMap(token => token.split(/[<>=]/)))

export const isGlob = (word: string) => /[*?[]/.test(word)

// `{a,b}` gives a word per choice, nested too, as bash does; `{1..3}` and a lone brace stay. Undefined past 64 words.
export const braceWords = (word: string): string[] | undefined => {
  const words: string[] = []
  const expand = (text: string): boolean => {
    for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
      const cuts = [start]
      let depth = 0
      for (let index = start; index < text.length; index++) {
        if (text[index] === '{') depth++
        else if (text[index] === ',' && depth === 1) cuts.push(index)
        else if (text[index] === '}' && --depth === 0) {
          if (cuts.length === 1) break
          const choices = [...cuts, index].slice(1).map((cut, at) => text.slice((cuts[at] ?? 0) + 1, cut))
          return choices.every(choice => expand(text.slice(0, start) + choice + text.slice(index + 1)))
        }
      }
    }
    words.push(text)
    return words.length <= 64
  }
  return expand(word) ? words : undefined
}

// One path part of a glob as a regex. `*` also matches a leading dot, and `**` is `*`. Undefined for a `[` left open, which
// the shell reads as itself.
export const globPart = (part: string): RegExp | undefined => {
  const source = part.replace(/[.+^$(){}|\\]/g, '\\$&').replace(/\*+/g, '.*').replace(/\?/g, '.').replace(/\[!/g, '[^')
  try {
    return new RegExp(`^${source}$`)
  } catch {
    return undefined
  }
}
