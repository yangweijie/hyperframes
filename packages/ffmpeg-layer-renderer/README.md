# @hyperframes/ffmpeg-layer-renderer

Layer-based FFmpeg compositing renderer for Hyperframes.

## What

Instead of per-frame full-page Chromium capture, split a composition into
independent layers, pre-render each dynamic layer once as a transparent asset
(ProRes 4444 MOV), then composite them with ffmpeg `overlay`. Static layers
are captured once; looping segments are replayed via ffmpeg `loop`.

Validated against Hyperframes' own multi-layer test composition
(`packages/producer/tests/vignelli-stacking`) and the real registry vignelli:
~29–31 dB PSNR vs the full-page render — at/above the composition's official
`minPsnr: 30` threshold — with the composite stage several× faster than frame
capture. The acceleration comes from reuse — reusable backgrounds, looping
segments, multi-layer composites — not from making a single layer cheaper to
capture.

## Two entry points

### 1. Automatic (recommended): split a host HTML into layers

```ts
import { renderCompositionFromHtml } from "@hyperframes/ffmpeg-layer-renderer";

await renderCompositionFromHtml("index.html", {
  projectDir: ".",
  workDir: "out/work",
  outputPath: "out/final.mp4",
  fps: 30,
  // Templating placeholders (e.g. Studio/gallery compositions).
  variables: {
    __VIDEO_SRC__: "a-roll.mp4",
    __VIDEO_DURATION__: "10.24",
  },
  // Progress callback (0–100, stage names) for UI progress bars.
  onProgress: ({ progress, stage }) => {
    console.log(`${stage}: ${progress}%`);
  },
});
```

This reads the host's `data-composition-src` elements (Hyperframes' official
layer mechanism), materializes each `<template>` sub-composition into a
standalone HTML, pre-renders it to a transparent asset, and composites
background + layers with a single ffmpeg `overlay` filtergraph. No hand-written
layer list required.

When the host has main-timeline content beyond bare media (curtain transitions,
a moving a-roll, …), the host-minus-subcomps is rendered as an opaque
background video first — absorbing those layers and carrying the audio track.

### 2. Manual: explicit layer list

```ts
import { renderLayerComposition } from "@hyperframes/ffmpeg-layer-renderer";

await renderLayerComposition(
  {
    background: { mediaPath: "bg.mp4", width: 1920, height: 1080, fps: 30, duration: 5 },
    layers: [
      { id: "badge", htmlPath: "badge-pop.html", start: 0, duration: 5, kind: "dynamic" },
      { id: "loop", htmlPath: "pulse.html", start: 1, duration: 4, kind: "loop", repeat: -1 },
    ],
  },
  { projectDir: ".", workDir: "out/work", outputPath: "out/final.mp4", fps: 30 },
);
```

## CLI

```bash
# Automatic: split index.html into layers and composite
hyperframes layer-render index.html -o out/final.mp4 --fps 30

# Manual: explicit JSON layer composition
hyperframes layer-render layer-composition.json -o out/final.mp4
```

## Studio integration

The Studio export panel offers an **"Export with FFmpeg"** button alongside the
standard "Export". It routes through the layer-compositing renderer
(`engine: "layer"` on the `/render` endpoint) for a faster export on
layer-structured compositions, with stage-aware progress reported back to the
render queue.

## Skill

本包附带一个 agent skill，把 `layer-render` 能力接入官方 `hyperframes-cli`
skill（让 agent 在生成视频时可选走 ffmpeg 加速）：

- `skill/SKILL.md` — `ffmpeg-layer-render-skill-patch`：按**锚点 + 操作**把
  `skills-patch/fragments.md` 里的三个片段合并进官方 skill（`SKILL.md` 的
  命令清单 + Render choices 表格、`references/preview-render.md` 的
  `layer-render` 章节）。
- `skills-patch/fragments.md` — 三个片段（锚点 + 操作 + 目标内容 + 幂等
  marker），抗行号漂移、可重复执行。

用**片段而非 diff**，因为官方 skill 随版本演进、行号会漂移，unified diff
会 corrupt。片段用稳定关键词定位、幂等（marker 已存在即跳过）。

## Test prompt

把下面这段提示词交给 Hyperframes agent（配合本包 skill），让它**100% 走
ffmpeg 加速**生成视频，用于测试 `layer-render` 全链路：

```text
使用 Hyperframes 的 ffmpeg 加速渲染（layer-render）生成一个视频：

1. 用 /hyperframes 创建工作流，做一个图层结构的产品发布视频（product launch）。
2. 组合必须采用图层结构：一个可复用的静态背景 + 至少两个
   data-composition-src 子组件（例如一个标题卡 overlays + 一个字幕 captions），
   子组件用 <template> 包裹。
3. 渲染时**只使用** ffmpeg 加速路径，不要用标准 render：
   npx hyperframes layer-render index.html -o out.mp4 --fps 30
4. 完成后报告：切出了几个图层、prerender 各阶段的耗时、composite 耗时，
   以及最终输出文件路径。
```

预期结果：agent 生成图层结构的 HTML 组合 → `layer-render` 自动切层 →
逐层预渲染透明 ProRes 资产 → ffmpeg overlay 合成，全程不经过标准整页截图。

## Architecture

| Module          | Purpose                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `types.ts`      | `LayerComposition`, `LayerSpec`, `BackgroundSpec`, `PrerenderResult`, `RenderProgressUpdate`      |
| `parse.ts`      | `parseLayerSpecs` — split host HTML → layers via `data-composition-src`                           |
| `variables.ts`  | `substituteVariables` — resolve `__UPPER__` / `{{token}}` / `<<token>>` / `${token}` placeholders |
| `standalone.ts` | `templateToStandalone` / `materializeStandalone` / `hasTemplate`                                  |
| `mainLayer.ts`  | `buildMainLayerHtml` / `needsMainLayerRender` — host-minus-subcomps main layer                    |
| `compose.ts`    | `buildFilterComplex` (pure) + `buildCompositeArgs`                                                |
| `codec.ts`      | `resolveCompositeCodec` — hardware encoder detection + audio-copy decision                        |
| `prerender.ts`  | One layer → transparent asset via `executeRenderJob`                                              |
| `render.ts`     | `renderCompositionFromHtml` + `renderLayerComposition` orchestrators                              |
| `parity.ts`     | `measurePsnr` gate via ffmpeg `psnr` filter                                                       |

Reuses `@hyperframes/producer` (capture) + `@hyperframes/engine`
(`runFfmpeg`, `detectGpuEncoder`, `extractAudioMetadata`).

## Layer kinds

| `kind`       | When                                                              |
| ------------ | ----------------------------------------------------------------- |
| `dynamic`    | A non-looping animated layer rendered once to a transparent asset |
| `loop`       | A short animated loop replayed via ffmpeg `loop=loop=-1`          |
| `static`     | A still layer captured as a single frame                          |
| `background` | A pre-rendered media path used as the base; no capture            |

## Video & audio encoding

- **Hardware acceleration**: `resolveCompositeCodec` probes the machine's GPU
  via the engine's `detectGpuEncoder` and picks `h264_amf` / `h264_nvenc` /
  `h264_qsv` / `h264_videotoolbox` with per-encoder parameters. `vaapi` falls
  back to software (it needs `hwupload` + a device context); no GPU falls back
  to `libx264`. WebM output stays software `libvpx-vp9`.
- **Audio copy**: the composite maps only the background's first audio track
  (`0:a:0?`) and copies it verbatim (`-c:a copy`) when it is AAC, matching the
  producer's `shouldCopyAacSidecar` behaviour. Non-AAC tracks are transcoded
  (`aac` for MP4, `libopus` for WebM).

## Caveats

- **Transparent assets are ProRes 4444 MOV by default**, not WebM. The gyan.dev
  ffmpeg build corrupts VP9 alpha during `scale` (alpha sidecar preserved but
  the main picture is blacked out). ProRes 4444 is the spike-verified carrier.
  See `plans/spike/vignelli-render-findings.md`.
- Transparent assets MUST enter the composite filtergraph as `yuva420p`; the
  pipeline enforces this via `format=yuva420p` before scaling. `overlay` uses
  `format=yuva420` (not `auto`) so alpha survives an opaque background.
- ffmpeg's `overlay` order is `[bg][fg]`; flipping it makes the foreground
  disappear. `compose.ts` comments this trap at the call site.
- On Windows, set `PRODUCER_HEADLESS_SHELL_PATH` to a working
  `chrome-headless-shell` build (see `.codebuddy/memory/2026-08-15.md`).

## 生成对比报告

`layer-render` 的加速收益来自**复用**（可复用背景、循环段、多层合成），
而非让单层截图更便宜。要量化收益，需把同一条组合分别走两条路径：

1. **layer-render**（ffmpeg 加速）：本包，逐层预渲染透明资产 + ffmpeg 合成。
2. **标准整页渲染**（producer）：逐帧全页 Chromium 截图后再编码。

两条路径产出的视频用 PSNR 比对保真度，用耗时比对速度。

### 1. 取两条路径的耗时

`renderCompositionFromHtml` 返回的 `LayerRenderResult` 已带分段耗时：

```ts
import { renderCompositionFromHtml } from "@hyperframes/ffmpeg-layer-renderer";

const layer = await renderCompositionFromHtml("index.html", {
  projectDir: ".",
  workDir: "out/work",
  outputPath: "out/layer.mp4",
  fps: 30,
});

// 加速路径分段耗时（ms）
const layerPrerenderMs = layer.prerenderMs; // 逐层预渲染（去重后只渲染动态层）
const layerCompositeMs = layer.compositeMs; // ffmpeg overlay 合成
const layerTotalMs = layer.prerenderMs + layer.compositeMs;
const layerCount = layer.layers.length; // 背景 + 各 overlay 层
// layer.layers: [{ role: "background" | kind, source, id }, ...]
```

标准整页渲染走 producer 的 `renderComposition`（见 `packages/producer`），
记录其端到端耗时 `standardTotalMs` 作为对照基线。

### 2. 用 PSNR 比对保真度

`parity.ts` 的 `measurePsnr` 把 layer 输出与标准整页输出逐帧比对：

```ts
import { measurePsnr, DEFAULT_PSNR_THRESHOLD } from "@hyperframes/ffmpeg-layer-renderer";

const parity = await measurePsnr(
  "out/standard.mp4", // 标准整页渲染（参考）
  "out/layer.mp4", // layer-render 输出（待测）
  { threshold: 30 }, // 组合官方 minPsnr 阈值（vignelli 为 30）
);

// parity.meanPsnr  —— 平均 PSNR (dB)，越高越接近整页渲染
// parity.minPsnr   —— 最差单帧 PSNR (dB)
// parity.passed    —— meanPsnr >= threshold ?
```

默认阈值 `DEFAULT_PSNR_THRESHOLD = 40`（与 Hyperframes 回归测试一致）。
vignelli / vignelli-stacking 实测约 **29–31 dB**，落在/高于官方
`minPsnr: 30`，且 composite 阶段比逐帧截图快数倍。

### 3. 汇总成对比报告

| 指标           | layer-render (ffmpeg) | 标准整页渲染      | 说明                         |
| -------------- | --------------------- | ----------------- | ---------------------------- |
| 切出图层数     | `layer.layers.length` | 1（整页）         | 复用点越多加速越明显         |
| prerender (ms) | `layer.prerenderMs`   | 含在 total 内     | 仅动态层，静态层只抓一次     |
| composite (ms) | `layer.compositeMs`   | 编码耗时          | ffmpeg overlay，数倍快于截图 |
| 总耗时 (ms)    | `layerTotalMs`        | `standardTotalMs` | 加速比 = `standard / layer`  |
| 平均 PSNR (dB) | `parity.meanPsnr`     | 参考 (∞)          | ≥ 阈值即通过                 |
| 最低 PSNR (dB) | `parity.minPsnr`      | 参考              | 最差帧保真度                 |
| 保真通过       | `parity.passed`       | —                 | `meanPsnr >= threshold`      |

读报告要点：

- **加速比**只看总耗时不够——layer 路径的加速来自背景/循环段复用，
  单一动态层、无可复用内容时，加速比接近 1（无收益）。
- **PSNR 不达标**先查透明资产是否以 `yuva420p` 进入滤镜图（见 Caveats），
  再查背景是否被不透明合成覆盖（overlay 顺序 `[bg][fg]` 写反会导致前景消失）。
- PSNR 对伽马/色彩空间轻微差异敏感，低于阈值但若视觉无差，可下调
  `threshold` 或改用 SSIM（ffmpeg `libvmaf` / `ssim` 滤镜）。
