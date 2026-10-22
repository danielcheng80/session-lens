import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Injection, Injections, Resident } from '../types'

const model = atom({ plugin: 'session-lens', key: 'model' } as const, '')
const injections = atom({ plugin: 'session-lens', key: 'injections' } as const, {} as Injections)
const round = atom({ plugin: 'session-lens', key: 'round' } as const, 0)
const output = atom({ plugin: 'session-lens', key: 'output' } as const, 0)
const contextPercent = atom({ plugin: 'session-lens', key: 'contextPercent' } as const, null as number | null)
const resident = atom({ plugin: 'session-lens', key: 'resident' } as const, [] as Resident[])
const isExpanded = atom({ plugin: 'session-lens', key: 'isExpanded' } as const, false)

const ACCENT = '#1f717a'
const CJK = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]/u
const WIDE = new RegExp(`${CJK.source}|\\p{Emoji_Presentation}`, 'u')
// 未比中規則的 hook 注入歸在這一組
const UNMATCHED = ''
const UNMATCHED_LABEL = '未比中'
// 不屬於任何 plugin 的 skill 歸在這一組
const LOCAL = '本機'
// 送進 subagent 的 hook 注入歸在這一組
const SUBAGENT = '\u0000subagent'
const NAME_MAX = 64
// 明細的名稱欄最寬 32 格
const NAME_W = 32

// 分組在畫面上的名稱
const groupLabel = (name: string): string =>
  name === UNMATCHED ? UNMATCHED_LABEL : name === SUBAGENT ? 'subagent' : name

// 中日韓字元約一字一 token，其餘約四字元一 token
export const estimateTokens = (text: string): number => {
  let cjk = 0
  let chars = 0
  for (const ch of text) {
    chars += 1
    if (CJK.test(ch)) cjk += 1
  }
  return Math.round(cjk + (chars - cjk) / 4)
}

// 終端機顯示寬度：全形字與 emoji 佔兩格
const width = (text: string): number => {
  let w = 0
  for (const ch of text) w += WIDE.test(ch) ? 2 : 1
  return w
}

const clip = (text: string, max: number): string => {
  if (width(text) <= max) return text
  let out = ''
  for (const ch of text) {
    if (width(out + ch) > max - 1) break
    out += ch
  }
  return out + '…'
}

export const formatTokens = (n: number): string =>
  n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 9950 ? 1 : 0)}k`

// claude-opus-5-5 → Opus 5.5，claude-opus-4-20250514 → Opus 4；認不出來就原樣顯示
export const prettyModel = (id: string): string => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id)
  if (!m) return id
  const [, family = '', major, minor] = m
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

// 「開頭文字=名稱」，以最後一個等號分開；格式不對的規則略過
export const parseRules = (lines: readonly string[]): [string, string][] =>
  lines.flatMap(line => {
    const at = line.lastIndexOf('=')
    const prefix = line.slice(0, at).trim()
    const name = line.slice(at + 1).trim()
    return at > 0 && prefix && name ? [[prefix, name.slice(0, NAME_MAX)] as [string, string]] : []
  })

// 只看注入內容的第一個非空行，先去掉引擎加的「SessionStart:startup hook success: 」這類前綴
export const matchRule = (rules: readonly [string, string][], text: string): string | undefined => {
  const first = (text.trimStart().split('\n', 1)[0] ?? '').replace(/^[\w:]+ hook [^:]*: /, '')
  return rules.find(([prefix]) => first.startsWith(prefix))?.[1]
}

// 依傳入的順序，挑出一行放得下的項目，其餘併成 +N
export const fitInline = (
  list: readonly (readonly [string, number])[],
  room: number,
): { shown: [string, string][]; rest: number } => {
  const shown: [string, string][] = []
  let used = 0
  for (const [i, [name, tokens]] of list.entries()) {
    const restAfter = list.length - i - 1
    const reserve = restAfter > 0 ? width(`  +${restAfter}`) : 0
    const piece = `  ${name} ${formatTokens(tokens)}`
    if (used + width(piece) + reserve > room) break
    shown.push([name, formatTokens(tokens)])
    used += width(piece)
  }
  return { shown, rest: list.length - shown.length }
}

const record = async ($: EngineInterface, group: string, item: string, tokens: number) => {
  const now = await read($, round)
  const g = group.slice(0, NAME_MAX)
  const k = item.slice(0, NAME_MAX)
  await update($, injections, all => {
    const items = all[g] ?? {}
    const prev = items[k] ?? { tokens: 0, count: 0, round: now }
    return { ...all, [g]: { ...items, [k]: { tokens: prev.tokens + tokens, count: prev.count + 1, round: now } } }
  })
}

const refreshModel = async ($: EngineInterface) => {
  const id = await $.session.model()
  await update($, model, () => id)
}

// 常駐成本：skill 清單依 plugin 分組，已載入的 MCP 工具依 server 分組，subagent 定義與記憶檔各一列
const refreshResident = async ($: EngineInterface) => {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  const sums = new Map<string, number>()
  const add = (name: string, tokens: number) => {
    const n = name.slice(0, NAME_MAX)
    sums.set(n, (sums.get(n) ?? 0) + tokens)
  }
  for (const s of b?.skills?.skillFrontmatter ?? []) add(s.pluginName || LOCAL, s.tokens)
  for (const t of b?.mcpTools ?? []) if (t.isLoaded) add(`MCP ${t.serverName}`, t.tokens)
  for (const a of b?.agents ?? []) add('subagent 定義', a.tokens)
  for (const f of b?.memoryFiles ?? []) add('記憶檔', f.tokens)
  const list = [...sums].map(([name, tokens]) => ({ name, tokens })).filter(r => r.tokens > 0)
  await Promise.all([
    update($, resident, () => list.sort((a, b) => b.tokens - a.tokens)),
    update($, contextPercent, () => context.percent ?? null),
  ])
}

export const register: Register = (on, options) => {
  const labels = options.hookLabels
  const rules = parseRules(Array.isArray(labels) ? labels : [])

  on('session.start', async ($, e, next) => {
    await refreshModel($)
    return next(e)
  })

  // /clear（含 /new）開出的新 session 不會觸發 session.start，改在這裡重新查模型與常駐成本
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear') await Promise.all([refreshModel($), refreshResident($)])
    return result
  })

  // session 結束（離開、/clear、resume）時清空統計與展開狀態
  on('session.end', async ($, e, next) => {
    await Promise.all([
      update($, injections, () => ({})),
      update($, round, () => 0),
      update($, output, () => 0),
      update($, contextPercent, () => null),
      update($, resident, () => []),
      update($, isExpanded, () => false),
    ])
    return next(e)
  })

  // 每段注入送給模型前觸發；只統計 hook 的輸出，其他來源直接放行
  on('prompt.attachment', async ($, e, next) => {
    const result = await next(e)
    if (e.origin.kind !== 'hook' || result.text === null) return result
    const event = e.origin.event
    const tokens = estimateTokens(result.text)
    const name = matchRule(rules, result.text)
    // 主對話裡未比中的只記合計；subagent 裡未比中的依事件分列
    if (e.agentId) await record($, SUBAGENT, name ?? `${event} hook`, tokens)
    else if (name) await record($, name, `${event} hook`, tokens)
    else await record($, UNMATCHED, UNMATCHED, tokens)
    return result
  })

  // 使用者每送出一則訊息，主對話就開始新的一輪；只處理主對話的 turn
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await Promise.all([update($, round, n => n + 1), update($, output, () => 0), refreshModel($)])
    }
    return next(e)
  })

  // 一輪結束後才查 context 用量與常駐成本
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      const out = result.usage?.output_tokens ?? 0
      await Promise.all([update($, output, n => n + out), refreshResident($)])
    }
    return result
  })

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    await record($, e.pluginName || LOCAL, e.skill, estimateTokens(result.text))
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [id, all, now, out, pct, residents, expanded] = await Promise.all([
      read($, model),
      read($, injections),
      read($, round),
      read($, output),
      read($, contextPercent),
      read($, resident),
      read($, isExpanded),
    ])
    if (!id) return next(e)

    // subagent 排在一般來源之後，未比中排在最後
    const rank = (name: string) => (name === UNMATCHED ? 2 : name === SUBAGENT ? 1 : 0)
    const sum = (items: Record<string, Injection>) => Object.values(items).reduce((s, u) => s + u.tokens, 0)
    const isNow = (u: Injection) => now > 0 && u.round === now
    const isFresh = (items: Record<string, Injection>) => Object.values(items).some(isNow)
    const groups = Object.entries(all)
      .map(([name, items]) => ({ name, items, tokens: sum(items), isFresh: isFresh(items) }))
      .sort((a, b) => rank(a.name) - rank(b.name) || b.tokens - a.tokens)
    const named = groups.filter(g => g.name !== UNMATCHED)
    const unmatched = all[UNMATCHED] ?? {}
    const total = groups.reduce((s, g) => s + g.tokens, 0)
    const residentTotal = residents.reduce((s, r) => s + r.tokens, 0)

    // 外框兩側各一格框線、一格留白
    const cols = e.props.bodyColumns - 4
    const { Box, Text, Button } = $.ui.resolve(e)
    const frame = (body: unknown) => (
      <Box borderStyle="round" borderDimColor paddingX={1}>
        {body}
      </Box>
    )

    const head = `● ${prettyModel(id)}`
    const usage = `${pct === null ? '' : ` · ctx ${Math.round(pct)}%`}${out > 0 ? ` · ↑${formatTokens(out)}` : ''}`
    const toggleLabel = expanded ? '收合' : '明細'
    const toggle = (
      <Button key="toggle" label={toggleLabel} onPress={() => update($, isExpanded, v => !v)} />
    )
    const headParts = [
      <Text key="model" color={ACCENT} bold>{head}</Text>,
      <Text key="usage" dimColor>{usage}</Text>,
    ]

    if (!expanded) {
      const inline = groups.map(g => [`${g.isFresh ? '●' : ''}${groupLabel(g.name)}`, g.tokens] as const)
      const empty = inline.length ? '' : ' · 尚未有注入'
      // 終端機把按鈕畫成「[ 標籤 ]」；寬度另外扣一格
      const room = cols - width(head + usage + empty) - 1 - width(`[ ${toggleLabel} ]`)
      const { shown, rest } = fitInline(inline, Math.max(0, room))
      return frame(
        <Box flexDirection="row" justifyContent="space-between" flexGrow={1}>
          <Text wrap="truncate-end">
            {headParts}
            <Text dimColor>{empty}</Text>
            {shown.map(([name, tok], i) => (
              <Text key={groups[i]?.name}>
                {'  '}
                {name} <Text dimColor>{tok}</Text>
              </Text>
            ))}
            {rest > 0 && shown.length > 0 ? <Text dimColor>{`  +${rest}`}</Text> : null}
          </Text>
          {toggle}
        </Box>
      )
    }

    // 明細：注入、常駐兩段，未比中只列合計
    const items = named.flatMap(g => Object.values(g.items))
    const max = Math.max(1, ...items.map(u => u.tokens))
    const labels = [
      ...named.flatMap(g => [groupLabel(g.name), ...Object.keys(g.items).map(k => `  ${k}`)]),
      ...residents.map(r => r.name),
    ]
    // 每列另需標記 2 格、空白 1 格、數字 5 格與次數 3 格；有長條時再加長條與 1 格空白
    // 48 欄以上一定畫長條，最少 8 格，空間不夠時先縮短名稱
    const longest = Math.max(...labels.map(width))
    const barW = cols >= 48 ? Math.max(8, Math.min(20, cols - 16 - Math.min(NAME_W, longest))) : 0
    const nameW = Math.max(4, Math.min(NAME_W, cols - 11 - (barW > 0 ? barW + 5 : 0), longest))
    const row = (key: string, name: string, use: { tokens: number; count?: number }, bar: boolean, fresh = false) => {
      const label = clip(name, nameW)
      const filled = Math.max(1, Math.round((use.tokens / max) * barW))
      const showBar = bar && barW > 0
      return (
        <Text key={key} wrap="truncate-end">
          <Text color={ACCENT}>{fresh ? '● ' : '  '}</Text>
          {label}
          {' '.repeat(nameW - width(label) + 1)}
          {showBar ? '█'.repeat(filled) : null}
          {showBar ? <Text dimColor>{'░'.repeat(barW - filled)} </Text> : null}
          {!bar && barW > 0 ? ' '.repeat(barW + 1) : null}
          {formatTokens(use.tokens).padStart(5)}
          <Text dimColor>{(use.count ?? 0) > 1 ? ` ×${use.count}` : ''}</Text>
        </Text>
      )
    }
    // 段落標題後接一句說明，放不下時截斷
    const heading = (key: string, text: string, note = '') => (
      <Text key={key} dimColor wrap="truncate-end">
        {note ? `${text}  ${note}` : text}
      </Text>
    )
    // 全螢幕時常駐全部列出；否則明細限半個視窗高，常駐放不下的併成一行
    const rows = e.viewport?.rows
    const limit = e.viewport?.isFullscreen === false && rows ? Math.floor(rows / 2) : Infinity
    const isEmpty = named.length === 0 && Object.keys(unmatched).length === 0
    // 外框上下、模型列、注入標題、常駐標題、未比中各佔一行
    const fixed = 4 + (isEmpty ? 1 : 0) + named.reduce((n, g) => n + 1 + Object.keys(g.items).length, 0)
      + (residents.length ? 1 : 0) + (Object.keys(unmatched).length ? 1 : 0)
    const room = limit - fixed
    const shownResident = barW === 0 ? [] : residents.length <= room ? residents : residents.slice(0, Math.max(0, room - 1))
    const restResident = residents.length - shownResident.length

    return frame(
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">{headParts}</Text>
          {toggle}
        </Box>
        {heading('h-inj', `注入 ≈ ${formatTokens(total)}`, 'skill 與 hook 加進對話的內容')}
        {isEmpty ? heading('none', '  尚未有注入') : null}
        {named.flatMap(g => [
          row(`g:${g.name}`, groupLabel(g.name), { tokens: g.tokens }, false, g.isFresh),
          ...Object.entries(g.items)
            .sort((a, b) => b[1].tokens - a[1].tokens)
            .map(([k, u]) => row(`i:${JSON.stringify([g.name, k])}`, `  ${k}`, u, true, isNow(u))),
        ])}
        {residents.length ? heading('h-res', `常駐 ≈ ${formatTokens(residentTotal)}`, '每輪固定送出的內容') : null}
        {shownResident.map(r => row(`r:${r.name}`, r.name, r, false))}
        {restResident > 0 && barW > 0 ? heading('r-rest', `  其他 ${restResident} 項`) : null}
        {Object.keys(unmatched).length
          ? heading('h-un', `${UNMATCHED_LABEL} ≈ ${formatTokens(sum(unmatched))}`, '認不出來源的 hook 注入')
          : null}
      </Box>
    )
  })
}
