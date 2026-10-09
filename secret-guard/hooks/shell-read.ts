// ponytail: split on shell operators outside quotes; sh -c, eval, globs, scripts the model writes and a quote left open across lines
// pass through. Output scrubbing is the net for those.
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
