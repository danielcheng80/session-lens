export type SkillUse = { tokens: number; count: number }

declare module 'claude-code' {
  interface PluginState {
    'session-lens': {
      model: string
      skills: Record<string, SkillUse>
      isExpanded: boolean
    }
  }
}
