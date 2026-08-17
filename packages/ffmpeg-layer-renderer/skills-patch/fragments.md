# layer-render skill 补丁片段

三个片段，按文件分组。每个片段含：目标文件、唯一锚点、操作、目标内容。
锚点必须**唯一**（在目标文件中只出现一次），否则合并会歧义。

---

## 片段 1 — SKILL.md 命令清单加入 `layer-render`

- **目标文件**: `skills/hyperframes-cli/SKILL.md`
- **操作**: `replace-line`（替换包含锚点关键词的整行）
- **锚点（定位关键词，稳定不随修改变化）**:
  ```
  single or batch render
  ```
- **替换后的整行**（若该行已含 `layer-render` 则跳过）:
  ```
  compare, grade-compare, preview, play, present, beats, keyframes, single or batch render, layer-render,
  ```
- **幂等判断**: 若目标文件中已存在包含 `single or batch render, layer-render,` 的行，则跳过本片段。

---

## 片段 2 — SKILL.md Render choices 表格加入一行

- **目标文件**: `skills/hyperframes-cli/SKILL.md`
- **操作**: `insert-after`
- **锚点（唯一）**:
  ```
  | Local variable-driven batch render       | `npx hyperframes render --batch rows.json --output "renders/{name}.mp4"`      |
  ```
- **插入内容（在锚点行之后）**:
  ```
  | Layer-structured faster local render     | `npx hyperframes layer-render index.html -o out.mp4 --fps 30`                 |
  ```
- **幂等判断**: 若目标文件已存在包含 `Layer-structured faster local render` 的行，则跳过本片段。

---

## 片段 3 — preview-render.md 加入 layer-render 章节

- **目标文件**: `skills/hyperframes-cli/references/preview-render.md`
- **操作**: `insert-before`
- **锚点（唯一）**:
  ```
  ### feedback (report after rendering)
  ```
- **幂等判断**: 若目标文件已存在 `## layer-render` 标题，则跳过本片段。
- **插入内容（在锚点行之前）**:

  ````markdown
  ## layer-render (FFmpeg 图层加速渲染)

  `layer-render` 是标准 `render` 的**可选加速替代**，通过 `@hyperframes/ffmpeg-layer-renderer` 把组合拆成独立图层，逐层预渲染为透明资产（ProRes 4444 MOV）后用 ffmpeg `overlay` 一次性合成。加速来自**复用**（背景、循环段、多图层合成），不是让单个图层变便宜。

  **何时用它**：组合是"图层结构"且满足以下任一条件时值得尝试——多层 `data-composition-src` 子组件、循环动画段（脉冲/旋转等）、可复用的静态背景、主 timeline 驱动的转场/幕布。单文件全屏 WebGL / 任意 DOM 动画的组合**不适用**（回退标准 `render`）。

  ```bash
  # 自动切层：直接吃 index.html（无需手写图层清单）
  npx hyperframes layer-render index.html -o out.mp4 --fps 30

  # 手动清单：JSON 配置（background + layers[]）
  npx hyperframes layer-render layer-composition.json -o out.mp4
  ```

  | Flag                 | Options            | Default  | Notes                                                                          |
  | -------------------- | ------------------ | -------- | ------------------------------------------------------------------------------ |
  | `input` (positional) | path               | —        | `index.html`（自动切层）或 JSON 配置（手动清单）                                |
  | `--output`, `-o`     | path               | —        | 输出路径                                                                        |
  | `--fps`              | number             | 30       | 仅 `index.html` 模式生效（JSON 配置自带 fps）                                   |
  | `--codec`            | libx264, libvpx-vp9| libx264  | 输出编码。libx264 (MP4/H.264)；libvpx-vp9 (WebM)                                |
  | `--prerender-format` | mov, webm          | mov      | 图层透明资产容器。mov (ProRes 4444，默认，alpha 可靠)；webm (VP9，部分 ffmpeg build alpha 有损) |
  | `--project-dir`      | path               | input 目录 | 组合项目目录                                                                    |
  | `--work-dir`         | path               | 输出目录/work | 中间资产目录                                                                    |

  **行为契约**（与标准 `render` 的差异）：

  - **自动切层**：`layer-render index.html` 读取主组合的 `data-composition-src` 元素作为图层，每个 `<template>` 子组件先 materialize 成 standalone HTML，再预渲染为透明资产。
  - **主层渲染**：主组合除子组件外还有主 timeline 内容（幕布、运动 a-roll）时，先整体渲染为不透明背景视频（含音频），再叠加子组件。
  - **模板占位符**：`__VIDEO_SRC__` / `__VIDEO_DURATION__` 等 `__UPPER__` 占位符需在渲染前替换（`renderCompositionFromHtml` 的 `variables` 参数）；CLI 自动切层模式下，占位符需已由上游（studio/画廊）填充，或改用 JSON 手动清单模式传入实际值。
  - **音频**：合成只映射背景第一条音轨（`0:a:0?`），AAC 时 `-c:a copy`（零损失），非 AAC 转码。
  - **硬件加速**：自动探测 GPU 编码器（AMF/NVENC/QSV/VideoToolbox），VAAPI 回退软件 libx264。
  - **进度**：分阶段进度（parse → materialize → render-main-layer → prerender:* → composite），映射到 0–100。

  **关系**：标准 `render` 是默认且保真最稳的路径；`layer-render` 是图层结构组合的加速替代。两者输出可对拍（PSNR），`layer-render` 在多层/循环/复用场景显著更快，单层场景无加速（透明层仍需预渲染一次）。不确定时就先用标准 `render`，明确是图层结构再尝试 `layer-render`。
  ````
