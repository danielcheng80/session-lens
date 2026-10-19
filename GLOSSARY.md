# session-lens

在輸入框上方顯示目前 session 裡，哪些來源把內容塞進對話、各塞了多少，以及對話實際用掉多少 token。

## Language

**來源**：
把內容注入對話的一方，目前有 skill 和 hook 兩種。按所屬的 plugin 分組。
_Avoid_：觸發者、provider

**注入**：
來源把一段文字加進對話，讓模型讀到。skill 展開和 hook 附加的 context 都算。
_Avoid_：載入、呼叫

**注入量**：
一次注入的文字估計佔多少 token，依文字長度推算，不是 API 回報的數字。
_Avoid_：skill token、用量

**實際用量**：
API 回報的 token 數，以及 context window 的佔用比例，會隨每次回覆變動。
_Avoid_：消耗量、注入量

**常駐成本**：
每一輪都會送出的固定內容所佔的 token，例如 skill 清單描述、MCP 工具定義、subagent 定義、CLAUDE.md。不算注入。
_Avoid_：基本開銷、overhead

**比對規則**：
使用者自訂的「開頭文字 → 名稱」對應，用來認出 hook 注入屬於哪個 plugin。主對話裡沒比中的注入只算合計，subagent 裡的依事件分列。
_Avoid_：指紋、偵測

**session 累計**：
從 session 開始到現在的總和，預設顯示這個範圍。
_Avoid_：總計、全部

**本輪**：
從使用者送出一則訊息，到模型回覆完畢之間。本輪有注入的來源會另外標記。
_Avoid_：這次、當下的對話
