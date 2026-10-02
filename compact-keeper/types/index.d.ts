export type KeeperEdited = string[]

declare module 'claude-code' {
  interface PluginState {
    'compact-keeper': {
      edited: KeeperEdited
    }
  }
}
