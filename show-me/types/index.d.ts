export type Diagram = { turnId: string; title: string; source: string; png?: string; width?: number; height?: number; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'show-me': {
      diagrams: Diagram[]
      index: number
    }
  }
}
