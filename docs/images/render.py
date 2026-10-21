# 產生 README 用的介面示意圖，輸出到這個資料夾：python3 docs/images/render.py
import unicodedata
from pathlib import Path
from xml.sax.saxutils import escape

FS, CW, LH = 14, 8.4, 22  # 字級、每格寬、行高
PAD = 20
C = dict(bg='#1a1d21', bar='#22262b', edge='#30353c', fg='#eceef0', dim='#7f8790',
         acc='#8ed9e1', frame='#4a5058', dot='#3a4048')


# 中日韓全形字佔兩格，其他佔一格，和終端機一致
def w(ch):
    return 2 if unicodedata.east_asian_width(ch) in 'WF' else 1


# 逐字指定 x 座標，換字型也不會跑位
def run(text, col, cls, y):
    xs, out = [], []
    for ch in text:
        if ch != ' ':
            xs.append(f'{col * CW:.1f}'); out.append(ch)
        col += w(ch)
    if not out:
        return '', col
    return f'<text class="{cls}" x="{" ".join(xs)}" y="{y}">{escape("".join(out))}</text>', col


def line(spans, col, y):
    parts = []
    for text, cls in spans:
        s, col = run(text, col, cls, y)
        parts.append(s)
    return ''.join(parts), col


def width(spans):
    return sum(w(ch) for t, _ in spans for ch in t)


# panel 是 mod 框內的各行，right 放在第一行最右側；框下方再畫輸入框
def svg(panel, right, name, cols):
    n = len(panel)
    top = 36 + 8
    x0 = PAD
    body = []
    def Y(row): return top + row * LH + 15
    fx, fy = x0 + CW * 0.5, top + LH * 0.5
    fw, fh = CW * (cols - 1), LH * (n + 1)
    body.append(f'<rect x="{fx:.1f}" y="{fy}" width="{fw:.1f}" height="{fh}" rx="7" fill="none" stroke="{C["frame"]}"/>')
    for i, spans in enumerate(panel):
        s, _ = line(spans, 2, Y(i + 1)); body.append(s)
    s, _ = line(right, cols - 2 - width(right), Y(1)); body.append(s)
    r = n + 2
    iy = top + LH * (r + 0.5)
    body.append(f'<rect x="{fx:.1f}" y="{iy}" width="{fw:.1f}" height="{LH * 2}" rx="7" fill="none" stroke="{C["edge"]}"/>')
    s, col = line([('> ', 'fg')], 2, Y(r + 1)); body.append(s)
    body.append(f'<rect x="{x0 + col * CW:.1f}" y="{Y(r + 1) - 13}" width="{CW:.1f}" height="17" fill="{C["fg"]}" opacity=".85"/>')
    s, _ = line([('? for shortcuts', 'dim')], 2, Y(r + 3)); body.append(s)
    H = top + LH * (r + 4) + PAD - 8
    W = CW * cols + PAD * 2
    g = '\n'.join(f'<g transform="translate({x0} 0)">{b}</g>' if b.startswith('<text') else b for b in body if b)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" viewBox="0 0 {W:.0f} {H:.0f}" role="img" aria-label="{name}">
<style>
text{{font:{FS}px "Geist Mono","SF Mono",Menlo,Consolas,"Noto Sans Mono CJK TC","PingFang TC",monospace;white-space:pre}}
.fg{{fill:{C["fg"]}}}.dim{{fill:{C["dim"]}}}.acc{{fill:{C["acc"]}}}.accb{{fill:{C["acc"]};font-weight:700}}
.title{{font-size:12px;fill:{C["dim"]};text-anchor:middle}}
</style>
<rect x=".5" y=".5" width="{W - 1:.0f}" height="{H - 1:.0f}" rx="12" fill="{C["bg"]}" stroke="{C["edge"]}"/>
<path d="M.5 36V12.5a12 12 0 0 1 12-12h{W - 25:.0f}a12 12 0 0 1 12 12V36z" fill="{C["bar"]}"/>
<line x1="0" y1="36" x2="{W:.0f}" y2="36" stroke="{C["edge"]}"/>
<circle cx="20" cy="18" r="6" fill="{C["dot"]}"/><circle cx="40" cy="18" r="6" fill="{C["dot"]}"/><circle cx="60" cy="18" r="6" fill="{C["dot"]}"/>
<text class="title" x="{W / 2:.0f}" y="22">claude · ~/my-app</text>
{g}
</svg>
'''


head = [('● Opus 5.5', 'accb'), (' · ctx 7% · ↑1.2k', 'dim')]

collapsed = [head + [('  ponytail ', 'fg'), ('2.6k', 'dim'), ('  ●caveman ', 'fg'), ('2.4k', 'dim'),
                     ('  未比中 ', 'fg'), ('861', 'dim')]]

# 明細的欄寬照 hooks/register.tsx 的算法：名稱 23 格、長條 20 格，長條以最大一項為滿格
NAME_W, BAR_W, MAX = 23, 20, 2600
def row(name, tok, num, bar=False, fresh=False, count=''):
    spans = [('● ' if fresh else '  ', 'acc'), (name + ' ' * (NAME_W - sum(w(c) for c in name) + 1), 'fg')]
    if bar:
        f = max(1, round(tok / MAX * BAR_W))
        spans += [('█' * f, 'fg'), ('░' * (BAR_W - f) + ' ', 'dim')]
    else:
        spans += [(' ' * (BAR_W + 1), 'fg')]
    spans += [(num.rjust(5), 'fg'), (count, 'dim')]
    return spans

detail = [
    head,
    [('注入 ≈ 6.8k  skill 與 hook 加進對話的內容', 'dim')],
    row('ponytail', 2600, '2.6k'),
    row('  SessionStart hook', 2600, '2.6k', bar=True),
    row('caveman', 2400, '2.4k', fresh=True),
    row('  SessionStart hook', 2000, '2.0k', bar=True),
    row('  UserPromptSubmit hook', 452, '452', bar=True, fresh=True, count=' ×4'),
    [('常駐 ≈ 13k  每輪固定送出的內容', 'dim')],
    row('本機', 5000, '5.0k'),
    row('記憶檔', 2300, '2.3k'),
    [('  其他 3 項', 'dim')],
    [('未比中 ≈ 861  認不出來源的 hook 注入', 'dim')],
]

d = Path(__file__).parent
(d / 'inline.svg').write_text(svg(collapsed, [('[ 明細 ]', 'fg')], 'session-lens 一行模式', 92), encoding='utf-8')
(d / 'detail.svg').write_text(svg(detail, [('[ 收合 ]', 'fg')], 'session-lens 明細', 74), encoding='utf-8')
