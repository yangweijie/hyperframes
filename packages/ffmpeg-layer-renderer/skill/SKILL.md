---
name: ffmpeg-layer-render-skill-patch
description: >
  Apply the ffmpeg-layer-renderer's skill fragments to the official
  hyperframes-cli agent skill. Use when the user wants the layer-render
  (FFmpeg layer-compositing) capability surfaced in the agent skill, or asks to
  "patch the skill", "update the official skill", or "add layer-render to the
  skill". Reads fragments.md, then merges each fragment into
  skills/hyperframes-cli/SKILL.md and references/preview-render.md by anchor.
---

# FFmpeg layer-render skill 补丁应用

把 `@hyperframes/ffmpeg-layer-renderer` 的 `layer-render` 能力接入官方
`hyperframes-cli` agent skill。**片段是源**（`skills-patch/fragments.md`），
本 skill 指导如何把它们合并进官方 skill 文件。

## 前置

- 官方 skill 根目录：`skills/hyperframes-cli/`（本仓库内）。
- 片段清单：`packages/ffmpeg-layer-renderer/skills-patch/fragments.md`。
- 三个片段，按锚点定位、按操作合并，幂等（锚点已存在即可跳过）。

## 应用流程

对 `fragments.md` 里的每个片段，依次执行：

1. **读目标文件**（片段头部标明的 `skills/hyperframes-cli/...`）。
2. **定位锚点**：在文件内容中查找片段里的"锚点"文本。
   - 锚点必须**唯一**。若出现多次，先向用户报告歧义，不要盲改。
   - 找不到锚点 → 说明目标文件已变更或已应用，向用户报告而非猜测。
3. **按操作合并**：
   - `replace`：把锚点整行替换为"新行/内容"。
   - `insert-after`：在锚点行**之后**插入指定内容。
   - `insert-before`：在锚点行**之前**插入指定内容。
4. **幂等检查**：合并前先检查目标内容是否已存在片段里的关键行；
   已存在则跳过该片段，不重复插入。
5. **保持格式**：插入内容须与目标文件的缩进、表格列宽、语言风格一致。
   片段内容已按目标文件风格写就，直接插入即可，勿自行改写措辞。

## 三个片段摘要

| # | 目标文件 | 操作 | 锚点 |
|---|----------|------|------|
| 1 | `SKILL.md` | replace | description 里 `single or batch render, publish,` 行 |
| 2 | `SKILL.md` | insert-after | Render choices 表格 `Local variable-driven batch render` 行 |
| 3 | `references/preview-render.md` | insert-before | `### feedback (report after rendering)` |

## 验证

合并完成后：

```bash
# 片段 1/2 的 marker：SKILL.md 出现 layer-render 命令
grep -n "layer-render index.html" skills/hyperframes-cli/SKILL.md
# 片段 3 的 marker：preview-render.md 出现 layer-render 章节
grep -n "## layer-render" skills/hyperframes-cli/references/preview-render.md
```

两个 marker 都在即成功。不要跑 `hyperframes render` 或 `layer-render`
（本 skill 只更新文档，不触发渲染）。

## 约束

- **只改这两个文件**，不要动其他 skill 或源码。
- 不要用 unified diff/patch 工具；按锚点文本直接编辑。
- 若官方 skill 已含 `layer-render`（marker 已存在），报告"已应用"，无需改动。
