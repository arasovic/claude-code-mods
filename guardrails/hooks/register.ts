import type { Register } from 'claude-code'

// Commands refused on their text. Credential reads are secret-guard's.
const FORBIDDEN = [
  { re: /\bcf\s+(deploy|migrate|init)\b/, why: 'cf write commands are never run by Claude; deploys stay on the Wrangler flow.' },
  { re: /\b(git\s+commit|gh\s+(pr|issue))\b[\s\S]*(Co-Authored-By|Generated with \[?Claude)/i, why: 'Remove the Co-Authored-By / tool-attribution line and retry.' },
  { re: /\bgit\s+(checkout\s+-b|switch\s+-c|branch|push)\b[^|;&]*\sclaude\//, why: 'Branches never use the claude/ prefix; use fix/, style/, chore/ etc.' },
]
// ponytail: matches command text only; `git commit -F file`, aliases and scripts slip through. Permission deny rules for hard guarantees.

export const forbiddenReason = (command: string) => FORBIDDEN.find(f => f.re.test(command))?.why

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const reason = forbiddenReason(e.command)
    return reason ? { deny: `${$.plugin.name}: ${reason}` } : next(e)
  })
}
