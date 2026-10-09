# session-lens

Claude Code mod：在輸入框上方顯示目前模型，以及本 session 用過的 skills 與估計 token 數。程式都在 `hooks/register.tsx`，`$.state` 的型別定義在 `types/index.d.ts`。

## 開發流程

每次改動都依序走完，每一步過了才往下：

1. **改程式**：新增或修改 `$.state` 的值時，同步更新 `types/index.d.ts`。
2. **補測試**：行為有變，就在 `hooks/register.test.tsx` 加上或修改對應的測試。改壞時要有測試會失敗。
3. **自動檢查**：`claude plugin validate .` 沒有錯誤，警告只剩「CLAUDE.md 不會當成 plugin 的 context 載入」這一則，`claude plugin test .` 全部通過。
4. **實際看畫面**：本機安裝的來源指向這個資料夾，執行 `/reload-plugins` 後，在真的 session 確認畫面正確。寬視窗、窄視窗、展開明細都要看過。
5. **更新文件**：README 裡受影響的範例畫面和說明要跟著改。
6. **更新版本號**：最後依 semver 調整 `.claude-plugin/plugin.json` 的 `version`。
   - 修正問題（fix）：升 patch，例如 0.2.0 → 0.2.1。
   - 新增功能或改變外觀（feat）：升 minor，例如 0.2.1 → 0.3.0。
   - `$.state` 的結構或使用方式不相容：升 major。
   - 已安裝的人靠版本號判斷有沒有新版，版本號沒變就收不到這次改動。
7. **commit**：用 Conventional Commits 格式，說明寫繁體中文。版本號和這次的改動放在同一個 commit。

## 資訊安全

這個 mod 會看到每個 skill 展開後的完整內容，處理時守住以下界線：

- **資料只留在 session 記憶體**：統計只存在 `$.state`。要用 `$.store`、`$.fs`、`$.process`、`$.model` 或任何網路存取之前，先問 Daniel，並在 README 寫明資料會去哪裡。
- **只存統計數字**：每個 skill 只記名稱、估計 token 數和使用次數。skill 的內容算完 token 就丟掉，不保存、不顯示、不寫進 log。
- **skill 名稱是外部輸入**：名稱來自其他 plugin，只拿來顯示，而且要先截斷長度。
- **新增 hook 要先確認**：`tool.call`、`prompt.submit`、`prompt.compose` 這類 hook 會碰到使用者的指令和對話內容。要加這類 hook，先跟 Daniel 確認範圍。
- **引擎產生的檔案不進版控**：`.claude-plugin/types/` 和 `tsconfig.json` 是 Claude Code 自動產生的，已經列在 `.gitignore`。
- **不放機密**：repo 是公開的，程式、測試和文件裡都不放 token、帳號或個人路徑。
