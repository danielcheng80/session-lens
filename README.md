# session-lens

Claude Code mod：在輸入框上方顯示目前 session 的模型，以及用過的 skills 與各自估計佔用的 token 數。終端機與 desktop app 都適用。

```
╭──────────────────────────────────────────────────────────────────────╮
│ ● Opus 5.5 · 6 skills ≈12k  brainstorming 3.2k  tdd 1.8k  +4    明細 │
╰──────────────────────────────────────────────────────────────────────╯
```

按「明細」展開成一 skill 一列，附比例長條與使用次數：

```
╭──────────────────────────────────────────────────────────────────────╮
│ ● Opus 5.5 · 6 skills ≈12k                                      收合 │
│   brainstorming  ████████████████████  3.2k                          │
│   tdd            ███████████░░░░░░░░░  1.8k ×2                       │
╰──────────────────────────────────────────────────────────────────────╯
```

- 外框是灰色圓角細框，上下各多佔一行；框線與左右留白共佔 4 欄。
- 右上角的 `[-]` 是 Claude Code 本身的收合鈕，按下或按 `ctrl+x ctrl+a` 會收起整條。
- 一行放不下時，依 token 數由多到少顯示，其餘收成 `+N`。
- 視窗窄到一個 skill 都放不下時，只顯示模型與摘要，不顯示 `+N`。
- 視窗窄於 48 欄時，明細只顯示數字、不畫長條。
- 明細裡超過 24 格的 skill 名稱會截斷，結尾補「…」。
- 還沒用過 skill 時顯示「尚未使用 skill」，沒有「明細」按鈕。
- 畫面出現問卷時，整條暫時隱藏。
- token 數是依 skill 展開後的文字估算（中日韓字元約一字一 token，其他約四字元一 token），誤差約一到兩成。
- 切換模型後，下一輪對話開始時才會更新顯示。
- 統計只存在 session 記憶體中，不寫入硬碟、不連網。

## 安裝

在 Claude Code 的輸入框執行：

```
/plugin install session-lens --marketplace danielcheng80/session-lens
```

出現提示時輸入 `y` 新增 marketplace，再選擇安裝範圍。

Claude Code 依 `plugin.json` 的版本號判斷有沒有新版，版本號沒變就不會更新。

## 開發

```sh
claude plugin validate .
claude plugin test .
```

本機開發時，把這個資料夾登記成 marketplace 後安裝，修改檔案再執行 `/reload-plugins` 即可生效：

```sh
claude plugin marketplace add ~/projects/session-lens
claude plugin install session-lens@session-lens
```
