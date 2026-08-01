# WordVault 划词翻译插件：链路与边界行为分析文档

> 本文档合并三轮分析，均基于仓库真实代码：
> [content.js](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js)、
> [background.js](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js)、
> [db.js](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/db.js)、
> [popup.js](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/popup.js)。

---

# 第一部分 · 断网划词「兜底提示消不掉」问题（第一轮）

## 一、结论先行

- 面板里那句英文提示是 **`Translation unavailable`**，它并不是 README 宣传的「三级智能灾备」中的任何一级产生的，而是 [background.js L88](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L88) 里 `trans` 变量的**初始默认值**。断网时三级策略全部抛错并被静默吞掉，这个默认值从头到尾没被覆盖，于是原样显示。
- 之所以「没报错」，是因为翻译失败在 background 里被 try/catch 拦下只打日志，最终仍以 `success: true` 返回。content 脚本只看 `success` 字段，看到成功就正常渲染，把兜底字符串当正常译文画了出来。
- 这个词能进生词本，是因为 [background.js L113](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L113) 的写库操作**无条件执行**——不管翻译成不成功，都会把这条记录（含兜底译文）`put` 进 Dexie 数据库。
- 联网后再划同一个词，提示消不掉、次数照涨，是因为 [background.js L78-L84](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L78-L84) 走「命中缓存」分支：只要库里有这个词，就直接自增次数并原样返回旧记录，**永不重新请求翻译接口**。没有任何「识别到占位符就重试」的逻辑，坏记录被永久固化。

## 二、从划词到面板渲染的完整链路

### 1. 触发与取选区（content.js）
按快捷键后，background 命令监听 [L5-L51](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L5-L51) 向当前标签页发 `TRIGGER_TRANSLATION`。content 的 [processSelection L20-L58](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L20-L58) 取选区：空文本或超 800 字符才走 Toast 分支 return。正常单词先 `showLoading`，再把 `LOOKUP_WORD` 发给 background 等返回。这一层**不判断翻译成败**，只按 `res.success` 决定渲染还是移除弹窗（[L52-L57](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L52-L57)）。

### 2. 后台查词（handleLookup）
[handleLookup L70-L120](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L70-L120) 先把词转小写作主键，再 `db.words.get(word)`：
- **命中（HIT）**：次数 +1、更新时间戳、写回、返回记录，**不碰网络**。
- **未命中（MISS）**：才调翻译和词典接口。`trans` 一上来被初始化成 `"Translation unavailable"`；`fetchTranslationStrategy` 包在 try/catch 里，抛错时**只 `console.log`，不改 `trans`、不改 `success`、不 return**。词典同理，失败则 meta 空。最后无条件构造 `newRecord` 并 `put`，返回 `success: true`。

### 3. 三级灾备的真实行为（断网时）
[fetchTranslationStrategy L152-L169](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L152-L169) 依次尝试 Google API → Google Web → MyMemory。断网时每个 `await fetch` 因网络错误 reject，三个 `try` 全落空，末尾 `throw new Error("All Backups Failed")`，被外层 catch 吞掉。所以「三级兜底」在断网下其实是全线抛错，显示的 `Translation unavailable` 是它们之外、更上层的**变量默认值**。

### 4. 面板渲染（renderPopup）
[renderPopup L106-L204](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L106-L204) 直接把 `data.translation` 塞进 `.meaning`（[L150](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L150)），不做任何合法性校验。兜底字符串和真实译文对它没区别——这就是「翻译栏没报错、显示一句英文」的直接原因。

## 三、生词本读写链路

- **底层**：Dexie 数据库 `WordVault`，表 `words` 以 `word` 为主键（[db.js L1-L5](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/db.js#L1-L5)）。
- **写入**：只发生在 background——MISS 分支 `put`（[L113](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L113)）、HIT 分支自增写回（[L81-L82](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L81-L82)）、手动 +1（[handleIncrement L122-L134](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L122-L134)）、加笔记（[handleUpdateNote L136-L147](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L136-L147)）。写库不设任何前置条件。
- **读取**：弹窗 [loadWords L4-L38](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/popup.js#L4-L38) 按 `lastUpdated` 倒序读全表，直接展示 `w.translation` 与 `w.count`。

## 四、为什么联网后提示永远消不掉、次数还照涨

第一次断网查词时，坏记录（`translation="Translation unavailable"`，`count=1`）已被固化。联网后再划同一词：`db.words.get(word)` 命中 → HIT 分支立刻 `count+1`、写回、`return` 旧记录，**在 `if (record)` 内部就返回，到不了下面的 API 请求代码**。译文永远是当初存的兜底串，次数每查一次涨一次。缓存把「失败占位」和「成功结果」用相同方式对待，且命中即短路，无有效性判断、无重试、无过期——除非手动清空 IndexedDB。

## 五、第一轮根因归纳

| 现象 | 直接代码原因 |
|---|---|
| 显示英文、翻译栏不报错 | `trans` 默认值 `"Translation unavailable"`（[L88](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L88)）；策略失败被吞且仍返回 `success:true` |
| 兜底来自哪一级 | 不是三级任何一级，而是策略之外的变量初始值；三级全抛错 |
| 失败的词进生词本 | MISS 分支无条件 `put`（[L113](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L113)） |
| 联网后提示消不掉 | HIT 分支短路返回，从不重请求（[L78-L84](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L78-L84)） |
| 次数照涨 | HIT 分支每次命中 `count+1` 写回 |

---

# 第二部分 · 翻译成功、词典失败的「半记录」问题（第二轮）

> 场景：前两个翻译源超时，第三源（MyMemory）成功返回译文，但取音标/例句的词典接口那一路挂掉。

## 一、结论先行

- 面板**正常显示词条和真实中文译文**，但**没有音标、没有词性标签、没有例句**，看起来像「精简版」词条，而不是报错。
- 这条半记录**没有任何自动补全音标和例句的机会**：下次查同词命中缓存走 HIT 短路分支，直接返回旧记录并自增次数，永不再请求词典接口。
- 唯一能补的是手动加「笔记」，但那写的是 `customEx`，和音标/词性/系统例句无关。

## 二、与断网场景的关键区别

第一轮断网时三级全挂抛错，`trans` 停在默认值。本场景 [fetchTranslationStrategy](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L152-L169) 的第三个 `try`（MyMemory）成功 `return` 了真实 `translatedText`，所以 `trans` 是**真实译文**。真正挂掉的是随后的词典那一路。

## 三、词典失败时记录被存成什么样

MISS 分支（[L86-L114](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L86-L114)）：
1. `trans` = MyMemory 真实译文。
2. `fetchDictionaryApi`（[L199-L221](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L199-L221)）抛错，被 [L99](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L99) 吞掉，`meta={}`。
3. 构造 `newRecord`（[L101-L111](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L101-L111)）：`translation` 真实 ✅；`phonetic`=`""`；`pos`=`""`；`systemEx`=`[]`；`customEx`=`[]`；`count`=1。
4. 半记录被无条件 `put`（[L113](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L113)），返回 `success:true`。

## 四、面板会渲染成什么样

`renderPopup` 逐字段条件渲染：

| 面板区域 | 代码判断 | 本场景结果 |
|---|---|---|
| 词条 | `data.displayWord \|\| data.word`（[L146](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L146)） | 正常显示 |
| 音标 | `data.phonetic ? ... : ''`（[L147](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L147)） | 空 → **不显示** |
| 词性标签 | `data.pos ? <span> : ''`（[L149](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L149)） | 空 → **不显示** |
| 译文 | `data.translation`（[L150](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L150)） | **正常显示真实译文** |
| 例句区 | `sysEx ? ... : ''`（[L152](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L152)） | 空 → **整块不渲染** |
| 我的笔记 | 恒定渲染（[L154-L161](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L154-L161)） | 「暂无笔记」+输入框 |
| 复习次数 | `data.count`（[L164](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L164)） | 1 次 |

净效果：只有「单词+中文译文+空笔记区+复习次数」，音标/词性/例句全部悄悄消失且无报错，与 README「网络不佳降级处理，不影响基础翻译」一致。弹窗 [popup.js L18-L32](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/popup.js#L18-L32) 里 `w.pos || '单词'` 退化成显示「单词」徽章。

## 五、后续有没有自动补全的机会

**没有。** 依据第一轮结论「本地已有记录时走 HIT 短路分支」：记录已写库 → 下次 `db.words.get` 命中 → HIT 分支（[L78-L84](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L78-L84)）只做 `count+1`/更新时间戳/写回并 `return`，**到不了 MISS 里的 `fetchDictionaryApi`**。无「缺字段补拉」判断、无重试、无过期，缺失字段永久固化。手动加笔记只进 `customEx`，补不进音标/词性/系统例句。

---

# 第三部分 · 大小写不同的同一个词会存几条（第三轮）

> 场景：第一次在某文中划了句首大写的 `Apple`，后来在另一篇文章里划了全小写的 `apple`。

## 一、结论先行

- 生词本里**最后只有 1 条记录**，不是 2 条。
- 面板（和生词本）显示的拼写**以第一次划词为准**——即首次写入时的原始拼写 `Apple`；第二次划小写 `apple` 不会改变显示拼写，只会让次数 +1。

## 二、沿用前两轮的三条结论作为判断依据

前两轮已确立三点，直接套用：

1. **拿什么当唯一标识**：`word` 字段是主键（[db.js L3-L4](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/db.js#L3-L4) `'&word, ...'`，`&` 表示唯一），而 `handleLookup` 一进来就把输入 `toLowerCase().trim()` 归一成这个主键（[background.js L71](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L71)）。
2. **何时写入**：只有 MISS 分支首次 `put` 时才建新记录，其中 `displayWord` 被设为**未经小写化的原始输入 `rawWord`**（[L103](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L103)）。
3. **写入后哪些字段还会变**：HIT 分支只改 `count` 和 `lastUpdated`（[L80-L81](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L80-L81)），**从不重写 `displayWord`、`translation` 等内容字段**。

## 三、逐步推演

1. 第一次划 `Apple`：`word` 归一成 `"apple"`；`get("apple")` 未命中 → MISS 建记录，主键 `word="apple"`，`displayWord="Apple"`（保留原始大写），`count=1`。
2. 第二次划 `apple`：`word` 归一同样是 `"apple"`；`get("apple")` **命中** → 走 HIT 分支，`count` 变 2、更新时间戳、写回。`displayWord` 仍是 `"Apple"`，纹丝不动。

因为主键相同，Dexie 的 `put` 是同键覆盖而非新增，全程只有一条记录。

## 四、面板与生词本显示以哪次为准

- 面板：`escapeHtml(data.displayWord || data.word)`（[content.js L146](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/content.js#L146)）优先用 `displayWord`。
- 生词本：`w.displayWord || w.word`（[popup.js L24](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/popup.js#L24)）同理。

由于 `displayWord` 只在首次 MISS 写入、之后 HIT 永不更新，两处显示的拼写都固定为**第一次划词的原始形态 `Apple`**。即便后来只划小写、划一百次，展示的仍是 `Apple`，只是次数在涨。

> 反过来若先划小写 `apple` 再划大写 `Apple`，结论对称：仍是 1 条记录，显示固定为首次的 `apple`。

## 五、与前两轮是否矛盾

**无逻辑矛盾，三轮结论自洽且互相印证：**

- 本轮依赖的「主键唯一 + 输入统一小写 + HIT 只改 `count`/`lastUpdated`」正是第一、二轮反复用到的同一套机制。第一轮「联网后同词命中不重查、次数照涨」、第二轮「半记录命中不补全」和本轮「大小写归一为同一条、显示不更新」，本质都是**同一条 HIT 短路规则**在不同场景下的表现。

**但需澄清一处措辞层面的不精确（非结论冲突）：**

- 第一轮为简述方便，多处说「显示的是当初存下的内容」时以 `translation` 为例。严格讲，`translation`/`phonetic`/`pos`/`systemEx`/`displayWord` 这些**内容字段一律只在首次 MISS 写入、之后 HIT 永不更新**；真正会随后续查询变化的只有 `count` 和 `lastUpdated`。本轮的 `displayWord` 固定不变，正是这条规则的直接体现，与前两轮同源，不构成矛盾。

**一个容易踩的直觉陷阱（在此显式指出）：**

- 直觉上「大写 `Apple` 和小写 `apple` 是两个不同字符串，应存两条」。但代码在**入口就统一小写**，主键层面二者等价，所以只有一条。若误以为存两条，就与第一轮确立的「`word` 主键 = 小写归一后的唯一标识」相矛盾——真正正确的是**一条**。

## 六、第三轮根因归纳

| 问题 | 结论 | 依据 |
|---|---|---|
| 存几条记录 | **1 条** | 输入统一 `toLowerCase`（[L71](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L71)）+ `word` 唯一主键（[db.js L3-L4](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/db.js#L3-L4)），同键 `put` 覆盖 |
| 显示以哪次为准 | **第一次（`Apple`）** | `displayWord` 仅首次 MISS 写入（[L103](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L103)），HIT 不更新（[L78-L84](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L78-L84)） |
| 第二次划词的影响 | 仅 `count`+1、刷新 `lastUpdated` | HIT 分支（[L80-L81](file:///Users/lilixian/工作相关/AI/ai-eval-workspace/sessions/code-eval-gsb/session-0731/source%20code/gsb0731-709/gsb0731-709-thor/frontend/background.js#L80-L81)） |
| 与前两轮 | 无矛盾，同源于 HIT 短路规则 | — |

---

# 附：三轮共通的一句话总结

WordVault 用「小写归一后的 `word`」作唯一主键，**内容字段只在首次未命中时写一次**，之后任何对同一词的查询都走 HIT 短路分支、只累加 `count` 和刷新 `lastUpdated`。这一条规则同时解释了：断网兜底串消不掉、半记录音标例句补不全、以及大小写不同的同一词只存一条且显示以首次为准——三者是同一机制的不同表现。

## 修复方向（供参考）

- HIT 分支增加判断：内容字段（译文/音标/例句）为空或为占位符时，重新请求接口补齐后写回。
- 或给记录加 `translationValid` / `metaComplete` 标记，命中时按标记决定是否补拉；对词典字段设过期时间允许周期重试。
- 若需保留大小写区分，则应调整主键策略或额外保存原始拼写的多形态（当前设计有意归一，通常是合理的）。
