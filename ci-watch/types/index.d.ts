export type CiWatchRun = { name: string; elapsedMs: number; expectedMs: number | null }

// What a watch waits for: each event in `required` since when, so a reload can resume the poll from the stored row.
export type CiWatchSpec = { cwd: string; sha: string; ref: string; labels: string[]; required: Record<string, number>; startedAt: number }

export type CiWatchItem = { id: string; label: string; runs: CiWatchRun[]; spec?: CiWatchSpec; result?: string; isFailed?: boolean }

export type CiWatchBroken = { workflow: string; at: string; url: string }

declare module 'claude-code' {
  interface PluginState {
    'ci-watch': { watches: CiWatchItem[]; broken: CiWatchBroken[] }
  }
}
