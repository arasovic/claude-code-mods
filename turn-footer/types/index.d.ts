export type FooterStats = { tools: number; failed: number; requests: number; agents: string[]; input: number; cached: number; output: number }
export type FooterRunning = { id: string; name: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'turn-footer': {
      live: FooterStats
      done: { durationMs: number; stats: FooterStats }[]
      running: FooterRunning[]
    }
  }
}
