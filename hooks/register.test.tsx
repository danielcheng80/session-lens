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
const engine = (on: any, percent = 42, extraTools: object[] = []) => {
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
            ...extraTools,
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
    expect(Boolean(await ui.find({ type: 'Text', text: /SessionStart hook/ }))).toBe(startsExpanded)
    await ui.press({ key: 'toggle' })
    expect(Boolean(await ui.find({ type: 'Text', text: /SessionStart hook/ }))).toBe(!startsExpanded)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'desktop', ...band(120) })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /SessionStart hook/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /UserPromptSubmit hook/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /×2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /常駐 ≈ 5\.5k  每輪固定送出的內容/ })).toBeDefined()
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

test('未比中在明細裡只列合計', async ($, on) => {
  engine(on)
  await $.turn.start({ text: '', turnId: 't1' })
  await inject($, 'SessionStart', 'AAA\n' + 'x'.repeat(400))
  await inject($, 'UserPromptSubmit', 'BBB\n' + 'x'.repeat(400))

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'desktop', ...band(120) })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /未比中 ≈ 202  認不出來源的 hook 注入/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /SessionStart|UserPromptSubmit/ })).toBeUndefined()
  await ui.unmount()
})

test('subagent 排在一般來源之後、未比中最後，常駐全部列出，名稱含 - 的列不互相蓋掉', async ($, on) => {
  const tools = ['A', 'B', 'C', 'D', 'E'].map(n => ({ name: n, serverName: n, tokens: 100, isLoaded: true }))
  engine(on, 42, tools)
  on('skill.prompt', () => ({ text: 'x'.repeat(40) }))
  await $.turn.start({ text: '', turnId: 't1' })
  await inject($, 'SessionStart', 'PONYTAIL MODE ACTIVE\n' + 'x'.repeat(40000), 'a1')
  await inject($, 'SessionStart', 'UNKNOWN\n' + 'x'.repeat(80000))
  // subagent 裡未比中的依事件分列
  await inject($, 'UserPromptSubmit', 'UNKNOWN', 'a1')
  // 名叫 subagent 的 plugin 不和 subagent 那組合併
  await $.skill.prompt({ skill: 's', text: '', pluginName: 'subagent' })
  await $.skill.prompt({ skill: 'c', text: '', pluginName: 'a-b' })
  await $.skill.prompt({ skill: 'b-c', text: '', pluginName: 'a' })
  await $.turn.complete(done('t1'))

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'desktop', ...band(120) })
  await ui.press({ key: 'toggle' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const at = (re: RegExp) => texts.findIndex(t => re.test(t))
  expect(texts.findLastIndex(t => /^(● | {2})subagent /.test(t))).toBeGreaterThan(at(/^(● | {2})a-b /))
  await ui.press({ key: 'toggle' })
  const line = (await ui.findAll({ type: 'Text', text: /未比中/ })).map(t => t.text).sort((a, b) => b.length - a.length)[0] ?? ''
  expect(line).toMatch(/subagent/)
  expect(line.indexOf('未比中')).toBeGreaterThan(line.indexOf('subagent'))
  expect(texts.filter(t => /^(● | {2})subagent /.test(t))).toHaveLength(2)
  expect(at(/^(● | {2}) {2}UserPromptSubmit hook /)).toBeGreaterThan(-1)
  expect(texts.filter(t => /^ {2}(MCP [A-E]|MCP Figma|superpowers|記憶檔) /.test(t))).toHaveLength(8)
  expect(at(/其他/)).toBe(-1)
  expect(at(/^(● | {2}) {2}c /)).toBeGreaterThan(-1)
  expect(at(/^(● | {2}) {2}b-c /)).toBeGreaterThan(-1)
  await ui.unmount()
})

test('80 欄時，30 字的 skill 名稱完整顯示，更長的截斷', async ($, on) => {
  engine(on)
  on('skill.prompt', () => ({ text: 'x'.repeat(400) }))
  const name = 'a'.repeat(30)
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: name, text: '', pluginName: 'p' })
  await $.skill.prompt({ skill: 'b'.repeat(40), text: '', pluginName: 'p' })

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(75) })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: new RegExp(`${name} +█{20}`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /b{29}… / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /注入 ≈ 200  skill 與 hook/ })).toBeDefined()
  await ui.unmount()
})

test('48 欄以上、名稱很長時，仍畫長條並列出常駐', async ($, on) => {
  engine(on)
  on('skill.prompt', () => ({ text: 'x'.repeat(400) }))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'a'.repeat(40), text: '', pluginName: 'p' })
  await $.turn.complete(done('t1'))

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(54) })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /█{8}/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MCP Figma/ })).toBeDefined()
  await ui.unmount()
})

test('終端機主畫面上，明細壓在半個視窗內；全螢幕時交給引擎捲動', async ($, on) => {
  const tools = ['A', 'B', 'C', 'D', 'E'].map(n => ({ name: n, serverName: n, tokens: 100, isLoaded: true }))
  engine(on, 42, tools)
  on('skill.prompt', () => ({ text: 'x'.repeat(40) }))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'c', text: '', pluginName: 'p' })
  await $.turn.complete(done('t1'))

  const residentRows = async (isFullscreen: boolean) => {
    const ui = await $.ui.mount({
      plugin: 'session-lens',
      surface: 'terminal',
      ...band(120),
      viewport: { columns: 124, rows: 24, isFullscreen },
    })
    // 展開狀態屬於 session，只在第一次按
    if (!isFullscreen) await ui.press({ key: 'toggle' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    await ui.unmount()
    return texts
  }

  // 24 行的視窗壓在 12 行內：外框、模型列、注入 3 行、常駐標題佔 7 行，常駐列 4 項加「其他 4 項」
  const main = await residentRows(false)
  expect(main.filter(t => /^ {2}(MCP |superpowers|記憶檔)/.test(t))).toHaveLength(4)
  expect(main.some(t => /其他 4 項/.test(t))).toBe(true)

  const full = await residentRows(true)
  expect(full.filter(t => /^ {2}(MCP |superpowers|記憶檔)/.test(t))).toHaveLength(8)
  expect(full.some(t => /其他/.test(t))).toBe(false)
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

test('plugin 名稱是空字串的 skill 歸到本機，不混進未比中', async ($, on) => {
  engine(on)
  on('skill.prompt', () => ({ text: 'x'.repeat(400) }))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'tdd', text: '', pluginName: '' })

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(120) })
  expect(await ui.find({ type: 'Text', text: /本機/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /未比中/ })).toBeUndefined()
  await ui.unmount()
})

test('比對規則設定不是陣列時當成沒有規則', { options: { hookLabels: 'PONYTAIL MODE=ponytail' } }, async ($, on) => {
  engine(on)
  await $.turn.start({ text: '', turnId: 't1' })
  await inject($, 'SessionStart', 'PONYTAIL MODE ACTIVE')

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(120) })
  expect(await ui.find({ type: 'Text', text: /未比中/ })).toBeDefined()
  await ui.unmount()
})
