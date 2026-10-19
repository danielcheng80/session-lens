export type Injection = { tokens: number; count: number; round: number }
export type Injections = Record<string, Record<string, Injection>>
export type Resident = { name: string; tokens: number }

declare module 'claude-code' {
  interface PluginState {
    'session-lens': {
      model: string
      injections: Injections
      round: number
      output: number
      contextPercent: number | null
      resident: Resident[]
      isExpanded: boolean
    }
  }
}
