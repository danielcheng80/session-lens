import { expect, test } from 'claude-code/testing'

import { estimateTokens, fitInline, formatTokens, prettyModel } from './register'

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

test('估算與格式化', async () => {
  expect(estimateTokens('abcdabcd')).toBe(2)
  expect(estimateTokens('繁體中文')).toBe(4)
  expect(estimateTokens('😀😀😀😀')).toBe(4)
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

test('一行放不下時收成 +N', async () => {
  const list = [
    ['brainstorming', { tokens: 3200, count: 1 }],
    ['tdd', { tokens: 1800, count: 1 }],
    ['writing-plans', { tokens: 900, count: 1 }],
  ] as const
  const narrow = fitInline(list.map(([n, u]) => [n, { ...u }]), 34)
  expect(narrow.shown.map(([n]) => n)).toEqual(['brainstorming', 'tdd'])
  expect(narrow.rest).toBe(1)
  expect(fitInline(list.map(([n, u]) => [n, { ...u }]), 200).rest).toBe(0)
})

test('skill 累計並在兩種介面上切換明細', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('skill.prompt', () => ({ text: 'x'.repeat(4000) }))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'tdd', text: '' })
  await $.skill.prompt({ skill: 'tdd', text: '' })
  await $.skill.prompt({ skill: 'brainstorming', text: '' })

  // 展開狀態屬於 session，兩種介面共用
  for (const [surface, startsExpanded] of [['terminal', false], ['desktop', true]] as const) {
    const ui = await $.ui.mount({ plugin: 'session-lens', surface, ...band(100) })
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 skills ≈3\.0k/ })).toBeDefined()
    expect(Boolean(await ui.find({ type: 'Text', text: /×2/ }))).toBe(startsExpanded)
    await ui.press({ key: 'toggle' })
    expect(Boolean(await ui.find({ type: 'Text', text: /×2/ }))).toBe(!startsExpanded)
    await ui.unmount()
  }
})

test('所有 skill 都是 0 token 時，明細仍畫出長條', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('skill.prompt', () => ({ text: '' }))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'tdd', text: '' })

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(100) })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /NaN/ })).toBeUndefined()
  await ui.unmount()
})

test('session 結束後清空 skill 統計', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('skill.prompt', () => ({ text: 'x'.repeat(4000) }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await $.turn.start({ text: '', turnId: 't1' })
  await $.skill.prompt({ skill: 'tdd', text: '' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const ui = await $.ui.mount({ plugin: 'session-lens', surface: 'terminal', ...band(100) })
  expect(await ui.find({ type: 'Text', text: /尚未使用 skill/ })).toBeDefined()
  await ui.unmount()
})
