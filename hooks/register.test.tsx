import { expect, test } from 'claude-code/testing'

import { estimateTokens, fitInline, formatTokens, matchRule, parseRules, prettyModel } from './register'

const band = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
})

// hook 的輸出以注入的形式送給模型
const inject = ($: any, event: string, text: string, agentId?: string) =>
  $.prompt.attachment({ type: 'hook_additional_context', text, origin: { kind: 'hook', event }, agentId })

const RULES = { hookLabels: ['PONYTAIL MODE=ponytail', 'CAVEMAN MODE=caveman'] }

const done = (turnId: string, agentId?: string) =>
  ({ answer: '', turnId, agentId, reason: 'answer', durationMs: 1, isAborted: false }) as any

// 模擬引擎：模型、context 用量與常駐分項；usage.calls 記錄查詢次數
const engine = (on: any, percent = 42) => {
  const usage = { calls: 0 }
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.start', ($: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', ($: unknown, e: { answer: string }) => ({
    text: e.answer,
    usage: { input_tokens: 10, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' },
  }))
  on('prompt.attachment', ($: unknown, e: { text: string }) => ({ text: e.text }))
  on('session.usage', () => (usage.calls++, {
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        window: 200000,
        percent,
        breakdown: {
          skills: { skillFrontmatter: [{ name: 'tdd', source: 'plugin', pluginName: 'superpowers', tokens: 3000 }] },
          mcpTools: [
            { name: 'x', serverName: 'Figma', tokens: 2000, isLoaded: true },
            { name: 'y', serverName: 'Gmail', tokens: 9000, isLoaded: false },
          ],
          agents: [],
          memoryFiles: [{ path: 'CLAUDE.md', type: 'User', tokens: 500 }],
        },
      },
    },
  }))
  return usage
}

test('估算與格式化', async () => {
  expect(estimateTokens('abcdabcd')).toBe(2)
  expect(estimateTokens('繁體中文')).toBe(4)
  expect(estimateTokens('😀😀😀😀')).toBe(1)
  expect(formatTokens(820)).toBe('820')
  expect(formatTokens(3240)).toBe('3.2k')
  expect(formatTokens(12800)).toBe('13k')
  expect(formatTokens(9949)).toBe('9.9k')
  expect(formatTokens(9960)).toBe('10k')
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-opus-4-20250514')).toBe('Opus 4')
  expect(prettyModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(prettyModel('custom-model')).toBe('custom-model')
})

test('比對規則只看第一個非空行的開頭', async () => {
  const rules = parseRules(['PONYTAIL MODE=ponytail', 'a=b=c', '沒有等號', '=空開頭', '空名稱='])
  expect(rules).toEqual([
    ['PONYTAIL MODE', 'ponytail'],
    ['a=b', 'c'],
  ])
  expect(matchRule(rules, '\n  PONYTAIL MODE ACTIVE\n# x')).toBe('ponytail')
  expect(matchRule(rules, '# x\nPONYTAIL MODE ACTIVE')).toBeUndefined()
  expect(matchRule(rules, 'SessionStart:startup hook success: PONYTAIL MODE ACTIVE')).toBe('ponytail')
  expect(matchRule(rules, 'UserPromptSubmit hook additional context: PONYTAIL MODE ACTIVE')).toBe('ponytail')
})

test('一行放不下時收成 +N', async () => {
  const list = [
    ['brainstorming', 3200],
    ['tdd', 1800],
    ['writing-plans', 900],
  ] as const
  const narrow = fitInline(list, 34)
  expect(narrow.shown.map(([n]) => n)).toEqual(['brainstorming', 'tdd'])
  expect(narrow.rest).toBe(1)
  expect(fitInline(list, 200).rest).toBe(0)
})

test('skill 與 hook 注入依 plugin 分組，未比中的另列', { options: RULES }, async ($, on) => {
  engine(on)
  on('skill.prompt', () => ({ text: 'x'.repeat(4000) }))
  await $.turn.start({ text: '', turnId: 't1' })
  await inject($, 'SessionStart', 'PONYTAIL MODE ACTIVE\n' + 'x'.repeat(4000))
  await inject($, 'SessionStart', '<EXTREMELY_IMPORTANT>\n' + 'y'.repeat(2000))
  await inject($, 'UserPromptSubmit', 'CAVEMAN MODE ACTIVE ' + 'z'.repeat(400))
  await $.skill.prompt({ skill: 'tdd', text: '', pluginName: 'superpowers' })
  await $.skill.prompt({ skill: 'tdd', text: '', pluginName: 'superpowers' })
  await $.turn.start({ text: '', turnId: 't2' })
  await inject($, 'UserPromptSubmit', 'CAVEMAN MODE ACTIVE ' + 'z'.repeat(400))
  // 送進 subagent 的注入另歸一組
  await inject($, 'SessionStart', 'PONYTAIL MODE ACTIVE', 'a1')
  // 不是 hook 來源的注入不算
  await $.prompt.attachment({ type: 'file', text: 'secret', origin: { kind: 'engine' } })
  await $.turn.complete(done('t2'))

  // 展開狀態屬於 session，兩種介面共用
  for (const [surface, startsExpanded] of [['terminal', false], ['desktop', true]] as const) {
    const ui = await $.ui.mount({ plugin: 'session-lens', surface, ...band(120) })
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ctx 42%/ })).toBeDefined()
    if (!startsExpanded) {
      expect(await ui.find({ type: 'Text', text: /superpowers/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /●caveman/ })).toBeDefined()
    }
    expect(Boolean(await ui.find({ type: 'Text', text: /SessionStart #1/ }))).toBe(startsExpanded)
    await ui.press({ key: 'toggle' })
    expect(Boolean(await ui.find({ type: 'Text', text: /SessionStart #1/ }))).toBe(!startsExpanded)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'desktop', ...band(120) })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /SessionStart hook/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /UserPromptSubmit hook/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /×2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /常駐 ≈5\.5k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MCP Figma/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MCP Gmail/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /subagent/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file|secret/ })).toBeUndefined()
  await ui.unmount()

  // 窄視窗的明細裡，名稱讓位給數字
  const slim = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(34) })
  expect(await slim.find({ type: 'Text', text: /UserPromptSubmit…/ })).toBeDefined()
  await slim.unmount()

  // 一個項目都放不下時，不畫會被截掉的 +N
  const narrow = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(30) })
  expect(await narrow.find({ type: 'Text', text: /\+\d/ })).toBeUndefined()
  await narrow.unmount()
})

test('沒有規則時，hook 注入都歸未比中', async ($, on) => {
  engine(on)
  await $.turn.start({ text: '', turnId: 't1' })
  await inject($, 'SessionStart', 'PONYTAIL MODE ACTIVE')

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(120) })
  expect(await ui.find({ type: 'Text', text: /未比中/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ponytail/ })).toBeUndefined()
  await ui.unmount()
})

test('本輪 output 只算主對話，換輪歸零', async ($, on) => {
  engine(on)
  await $.turn.start({ text: '', turnId: 't1' })
  await $.turn.complete(done('t1'))
  await $.turn.complete(done('s1', 'a1'))

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(120) })
  expect(await ui.find({ type: 'Text', text: /↑1\.5k/ })).toBeDefined()
  await ui.unmount()

  await $.turn.start({ text: '', turnId: 't2' })
  const next = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(120) })
  expect(await next.find({ type: 'Text', text: /↑/ })).toBeUndefined()
  await next.unmount()
})

test('一輪開始時不查用量，結束後才更新', async ($, on) => {
  const usage = engine(on)
  await $.turn.start({ text: '', turnId: 't1' })
  expect(usage.calls).toBe(0)
  await $.turn.complete(done('t1'))
  expect(usage.calls).toBe(1)
})

test('所有項目都是 0 token 時，明細仍畫出長條', async ($, on) => {
  engine(on)
  on('skill.prompt', () => ({ text: '' }))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'tdd', text: '' })

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(100) })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /NaN/ })).toBeUndefined()
  await ui.unmount()
})

test('session 結束後清空統計', async ($, on) => {
  engine(on)
  on('skill.prompt', () => ({ text: 'x'.repeat(4000) }))
  on('session.end', ($: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'tdd', text: '' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(100) })
  expect(await ui.find({ type: 'Text', text: /尚未有注入/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui.unmount()
})
