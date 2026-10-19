# session-lens

Claude Code mod：在輸入框上方顯示目前的模型、context 用量，以及這個 session 裡各 plugin 透過 skill 和 hook 注入了多少內容。終端機與 desktop app 都適用。

## 這個 mod 在算什麼

送給模型的 context 裡，有一部分是 plugin 加進來的。這個 mod 把這部分拆成兩類：

- **注入**：對話途中才加進來的內容，包括 skill 被叫用時展開的全文，以及 hook（例如 SessionStart、UserPromptSubmit）附加的文字。從 session 開始一路累加。
- **常駐**：每一輪都會跟著送出的固定內容，例如各 plugin 的 skill 清單、MCP 工具定義、subagent 定義、CLAUDE.md 等記憶檔。顯示的是最近一次查到的數字，不累加。

不只算 skill：hook 注入、MCP 工具和記憶檔也都算在內。另外，注入是 session 累計，對話壓縮（compact）後也不會扣掉，所以可能比 context 裡實際剩下的還多。context 目前用了多少，以 `ctx` 為準。

## 一行模式

```
╭──────────────────────────────────────────────────────────────────────────────────────╮
│ ● Opus 5.5 · ctx 7% · ↑1.2k  ponytail 2.6k  ●caveman 2.4k  未比中 861           明細 │
╰──────────────────────────────────────────────────────────────────────────────────────╯
```

由左到右依序是：

- `● Opus 5.5`：目前的模型。
- `ctx 7%`：context window 目前用掉的比例，涵蓋系統提示、工具定義、對話紀錄等所有內容，數字是 Claude Code 在本機估算的。
- `↑1.2k`：最近一輪主對話裡，模型總共輸出了多少 token。一輪是指從你送出訊息，到模型回覆完畢為止。這段時間裡每一次請求的輸出都會加總，包括思考、文字和工具呼叫的參數；subagent 的輸出不算。新的一輪開始時這個數字會先消失，回覆完畢後才再出現。
- `ponytail 2.6k` 這類項目：各 plugin 在這個 session 累計注入的量，由多到少排列。subagent 排在一般來源之後，未比中固定排在最後。名稱前有 `●` 的，表示這一輪有注入。

## 明細

按「明細」展開，分成注入、常駐兩段，最後列出未比中的合計：

```
╭──────────────────────────────────────────────────────────────────────╮
│ ● Opus 5.5 · ctx 7% · ↑1.2k                                     收合 │
│ 注入 ≈ 6.8k  skill 與 hook 加進對話的內容                            │
│   ponytail                                       2.6k                │
│     SessionStart hook      ████████████████████  2.6k                │
│ ● caveman                                        2.4k                │
│     SessionStart hook      ███████████████░░░░░  2.0k                │
│ ●   UserPromptSubmit hook  ███░░░░░░░░░░░░░░░░░   452 ×4             │
│ 常駐 ≈ 13k  每輪固定送出的內容                                       │
│   本機                                           5.0k                │
│   記憶檔                                         2.3k                │
│ 未比中 ≈ 861  認不出來源的 hook 注入                                 │
╰──────────────────────────────────────────────────────────────────────╯
```

- **注入**：skill 展開的內容，以及 hook 附加給模型的 context，依 plugin 分組。`×N` 是次數。
- **常駐**：每一輪都會送出的固定內容，例如各 plugin 的 skill 清單、已載入的 MCP 工具定義、subagent 定義、CLAUDE.md 等記憶檔。全螢幕模式下全部列出，超過這一區的高度時，用滑鼠滾輪或鍵盤捲動；一般模式下，明細最多佔半個視窗高，常駐放不下的併成「其他 N 項」。
- **未比中**：認不出是哪個 plugin 注入的 hook 內容，只列一個合計。Claude Code 不提供 hook 注入的來源，要細分就得寫比對規則。
- 送進 subagent 的 hook 注入另歸「subagent」一組，比中規則的依名稱分列，未比中的依事件名稱分列。即使有 plugin 也叫 subagent，兩組也不會合併。skill 分辨不出是在主對話還是 subagent 裡展開的，所以一律算在主對話。
- 不屬於任何 plugin 的 skill（個人、專案或內建的 skill）歸在「本機」。

## 認出 hook 是哪個 plugin 注入的

引擎不會告訴 mod 某段 hook 注入是哪個 plugin 的，所以要自己設定比對規則。執行 `/config`，找到「hook 比對規則」，一條寫一行，格式是「開頭文字=名稱」：

```
PONYTAIL MODE=ponytail
CAVEMAN MODE=caveman
<EXTREMELY_IMPORTANT>=superpowers
```

- 只比對注入內容的第一行。引擎加在前面的「SessionStart:startup hook success: 」這類前綴會先去掉。
- 比對完內容就丟掉，不保存也不顯示。
- 預設沒有任何規則，沒設定時所有 hook 注入都列在「未比中」。
- 更新 plugin 不會清掉規則，但**移除 plugin 時規則會一起刪除**，重裝後要重新填。
- 其他 plugin 改了注入內容的開頭，規則就會失準，要自己更新。

## 其他說明

- 外框是灰色圓角細框，上下各多佔一行；框線與左右留白共佔 4 欄。
- 右上角的 `[-]` 是 Claude Code 本身的收合鈕，按下或按 `ctrl+x ctrl+a` 會收起整條。
- 一行放不下時，依上面的順序從前面開始顯示，其餘收成 `+N`。視窗窄到一個都放不下時，不顯示 `+N`。
- 視窗窄於 48 欄時，明細不畫長條，常駐只顯示加總；名稱會縮短，讓數字完整顯示。48 欄以上一定畫長條，空間不夠時先縮短名稱。
- 明細裡超過 32 格的名稱會截斷，結尾補「…」；80 欄的終端機放得下 32 格名稱加完整長條。段落標題後的說明放不下時同樣截斷。
- 畫面出現問卷時，整條暫時隱藏。
- 注入量是依文字估算的（中日韓字元約一字一 token，其他約四字元一 token），誤差約一到兩成。常駐成本用的是 Claude Code 在本機的估算，不會連網。
- 執行 `/reload-plugins` 後，session 開頭的 hook 注入會被重送一次，數字會多算一次。
- 模型在每一輪開始時更新；context 用量與常駐成本在每一輪結束時更新，第一輪結束前不會顯示。

## 資料範圍

- 統計只存在 session 記憶體中，不寫入硬碟、不連網。session 結束（離開、`/clear`、resume）時清空。
- mod 會看到每段送給模型的注入內容，但只處理 hook 輸出的那些；你用 `@` 提到的檔案、系統提醒等其他內容一律直接放行，不讀取也不計算。
- skill 和 hook 的內容只拿來估算 token，算完就丟，不保存、不顯示。
- 這個 mod 不讀取你送出的訊息。

## 安裝

在 Claude Code 的輸入框執行：

```
/plugin install session-lens --marketplace danielcheng80/session-lens
```

出現提示時輸入 `y` 新增 marketplace，再選擇安裝範圍。

Claude Code 依 `plugin.json` 的版本號判斷有沒有新版，版本號沒變就不會更新。

從 0.x 升到 1.0 時，統計的資料結構換了，升級後請開一個新的 session。

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
