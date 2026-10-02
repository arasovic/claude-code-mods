export type TimelineSpan = { id: string; lane: string; kind: 'model' | 'tool'; name: string; detail: string; start: number; end?: number; ok?: boolean }
export type TimelineLane = { id: string; label: string }
export type TimelineTurn = { start: number; end?: number; lanes: TimelineLane[]; spans: TimelineSpan[] }

declare module 'claude-code' {
  interface PluginState {
    'turn-timeline': {
      turn: TimelineTurn | null
    }
  }
}
