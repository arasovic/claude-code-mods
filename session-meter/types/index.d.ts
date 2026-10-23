export type MeterLimit = { kind: string; percentUsed: number; resetsAt?: string }
export type MeterReading = { context: number | null; limits: MeterLimit[] }
export type MeterCategory = { name: string; tokens: number; color: string; kind: string }
export type MeterItem = { name: string; tokens: number }
export type MeterBreakdown = { percent: number; tokens: number; window: number; threshold?: number; categories: MeterCategory[]; heaviest: MeterItem[] }
export type MeterSample = { kind: string; at: number; pct: number; resetsAt?: string }
export type MeterNote = { at: number; text: string }
export type MeterTool = { id: string; name: string; target: string; sub: boolean; at: number; ms?: number; ok?: boolean }
export type MeterRequest = { at: number; agent: string; input: number; cached: number; output: number; ms: number; model: string }
export type MeterReset = { mode: 'compact'; next?: string; wait?: true } | { mode: 'clear'; handoff: string }
export type MeterResume = { alone?: string; carried: string; ready?: true; taken?: true }

declare module 'claude-code' {
  interface PluginState {
    'session-meter': {
      reading: MeterReading
      fired: string[]
      breakdown: MeterBreakdown | null
      history: number[]
      samples: MeterSample[]
      notes: MeterNote[]
      tools: MeterTool[]
      requests: MeterRequest[]
      pending: MeterReset | null
      resume: MeterResume | null
    }
  }
}
