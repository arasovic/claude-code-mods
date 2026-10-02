export type LedgerFile = { path: string; added: number; removed: number; edits: number; at: number; agents: string[]; created: boolean }
export type LedgerGitFile = { path: string; status: string; added?: number; removed?: number }
export type LedgerGit = { root: string; branch: string; ahead: number; behind: number; files: LedgerGitFile[] }

declare module 'claude-code' {
  interface PluginState {
    'change-ledger': {
      files: LedgerFile[]
      git: LedgerGit | null
    }
  }
}
