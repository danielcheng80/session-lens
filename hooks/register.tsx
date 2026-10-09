import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SkillUse } from '../types'

const model = atom({ plugin: 'session-lens', key: 'model' } as const, '')
const skills = atom(
  { plugin: 'session-lens', key: 'skills' } as const,
  {} as Record<string, SkillUse>,
)
const isExpanded = atom({ plugin: 'session-lens', key: 'isExpanded' } as const, false)

const ACCENT = '#4fa8b2'
const CJK = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

// 中日韓字元約一字一 token，其餘約四字元一 token
export const estimateTokens = (text: string): number => {
  let cjk = 0
  for (const ch of text) if (CJK.test(ch)) cjk += 1
  return Math.round(cjk + (text.length - cjk) / 4)
}

// 終端機顯示寬度：全形字佔兩格
const width = (text: string): number => {
  let w = 0
  for (const ch of text) w += CJK.test(ch) ? 2 : 1
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
  n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`

// claude-opus-5-5 → Opus 5.5；認不出來就原樣顯示
export const prettyModel = (id: string): string => {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  if (!m) return id
  const [, family = '', major, minor] = m
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}.${minor}`
}

// 依 token 數由多到少，挑出一行放得下的 skill，其餘併成 +N
export const fitInline = (
  list: readonly [string, SkillUse][],
  room: number,
): { shown: [string, string][]; rest: number } => {
  const shown: [string, string][] = []
  let used = 0
  for (const [i, [name, use]] of list.entries()) {
    const restAfter = list.length - i - 1
    const reserve = restAfter > 0 ? width(` +${restAfter}`) : 0
    const piece = `  ${name} ${formatTokens(use.tokens)}`
    if (used + width(piece) + reserve > room) break
    shown.push([name, formatTokens(use.tokens)])
    used += width(piece)
  }
  return { shown, rest: list.length - shown.length }
}

const refreshModel = async ($: EngineInterface) => {
  const id = await $.session.model()
  await update($, model, () => id)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refreshModel($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await refreshModel($)
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    const tokens = estimateTokens(result.text)
    await update($, skills, all => {
      const prev = all[e.skill] ?? { tokens: 0, count: 0 }
      return { ...all, [e.skill]: { tokens: prev.tokens + tokens, count: prev.count + 1 } }
    })
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const id = await read($, model)
    if (!id) return next(e)

    const used = Object.entries(await read($, skills)).sort((a, b) => b[1].tokens - a[1].tokens)
    const expanded = await read($, isExpanded)
    const cols = e.props.bodyColumns
    const total = used.reduce((sum, [, u]) => sum + u.tokens, 0)
    const { Box, Text, Button } = $.ui.resolve(e)

    const modelLabel = prettyModel(id)
    const summary = used.length ? ` · ${used.length} skills ≈${formatTokens(total)}` : ' · 尚未使用 skill'
    const toggle = used.length ? (
      <Button
        key="toggle"
        label={expanded ? '收合' : '明細'}
        onPress={() => update($, isExpanded, v => !v)}
      />
    ) : null

    const header = (
      <Text wrap="truncate-end">
        <Text color={ACCENT} bold>● {modelLabel}</Text>
        <Text dimColor>{summary}</Text>
      </Text>
    )

    if (!expanded) {
      const room = cols - width(`● ${modelLabel}${summary}`) - 8
      const { shown, rest } = fitInline(used, Math.max(0, room))
      return (
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color={ACCENT} bold>● {modelLabel}</Text>
            <Text dimColor>{summary}</Text>
            {shown.map(([name, tok]) => (
              <Text key={name}>
                {'  '}
                {name} <Text dimColor>{tok}</Text>
              </Text>
            ))}
            {rest > 0 ? <Text dimColor>{`  +${rest}`}</Text> : null}
          </Text>
          {toggle}
        </Box>
      )
    }

    // 明細：一 skill 一列，名稱、長條、token 數、使用次數；太高時由引擎捲動
    const max = used[0]?.[1].tokens ?? 1
    const nameW = Math.min(24, Math.max(...used.map(([n]) => width(n))))
    const barW = cols >= 48 ? Math.min(20, cols - nameW - 16) : 0
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          {header}
          {toggle}
        </Box>
        {used.map(([name, use]) => {
          const label = clip(name, nameW)
          const filled = Math.max(1, Math.round((use.tokens / max) * barW))
          return (
            <Text key={name} wrap="truncate-end">
              {'  '}
              {label}
              {' '.repeat(nameW - width(label) + 1)}
              {barW > 0 ? <Text color={ACCENT}>{'█'.repeat(filled)}</Text> : null}
              {barW > 0 ? <Text dimColor>{'░'.repeat(barW - filled)} </Text> : null}
              {formatTokens(use.tokens).padStart(5)}
              <Text dimColor>{use.count > 1 ? ` ×${use.count}` : ''}</Text>
            </Text>
          )
        })}
      </Box>
    )
  })
}
