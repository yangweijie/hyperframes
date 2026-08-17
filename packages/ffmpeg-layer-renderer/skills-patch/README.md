# FFmpeg layer-render — skill 补丁片段

本目录存放把 `layer-render`（FFmpeg 图层加速渲染）能力接入官方 agent skill
（`skills/hyperframes-cli/`）所需的**修改片段**。

- `fragments.md` — 每个修改点的锚点 + 目标内容（人类/agent 都可读）。
- 配套 skill：`../skill/`（`ffmpeg-layer-render` skill），指导 agent 如何把这些
  片段合并进官方 skill。

## 为什么用片段而非 diff

官方 skill 文件随版本演进，行号会漂移，unified diff 的 `@@ -N,M +N,M` 会因
行号失效而 corrupt。改用**唯一锚点文本 + 操作**描述修改，agent 按锚点定位、
按操作合并，抗行号漂移且幂等（锚点已存在即可跳过）。

## 应用方式

见 `../skill/SKILL.md`：agent 读取 `fragments.md`，对每个片段在目标文件中
按锚点定位，执行 `insert-after` / `replace` 操作。
