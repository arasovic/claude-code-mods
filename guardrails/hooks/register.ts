import type { PluginOptions, Register } from 'claude-code'

// Commands refused on their text, each behind its userConfig toggle. Credential reads are secret-guard's.
const RULES = [
  { option: 'cfWrites', re: /\bcf\s+(deploy|migrate|init)\b/, why: 'cf deploy, migrate and init are blocked; ask the user to run them.' },
  { option: 'attribution', re: /\b(git\s+commit|gh\s+(pr|issue))\b[\s\S]*(Co-Authored-By|Generated with \[?Claude)/i, why: 'Remove the Co-Authored-By / tool-attribution line and retry.' },
  { option: 'claudeBranches', re: /\bgit\s+(checkout\s+-b|switch\s+-c|branch|push)\b[^|;&]*(?:[\s:+]|refs\/heads\/)claude\//, why: 'Branch names may not start with claude/; use a purpose prefix such as fix/ or chore/.' },
]
// ponytail: matches command text only; `git commit -F file`, aliases and scripts slip through. Permission deny rules for hard guarantees.

export const forbiddenReason = (command: string, options: PluginOptions) =>
  RULES.find(r => options[r.option] === true && r.re.test(command))?.why

export const register: Register = (on, options) => {
  if (!RULES.some(r => options[r.option] === true)) return
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const reason = forbiddenReason(e.command, options)
    return reason ? { deny: `${$.plugin.name}: ${reason}` } : next(e)
  })
}
