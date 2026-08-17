# 交付清单与 PR 说明

`@hyperframes/ffmpeg-layer-renderer` 的完整交付记录，供提交 PR 或本地/团队内使用。

## 已交付的能力

### 1. 核心扩展包 `packages/ffmpeg-layer-renderer/`

图层化 FFmpeg 合成渲染器，两个入口：

| 入口 | 用途 |
|------|------|
| `renderCompositionFromHtml(htmlPath, opts)` | 自动切层（`data-composition-src`）→ 主层渲染 → 子组件 materialize → 逐层预渲染透明资产 → ffmpeg overlay 合成 |
| `renderLayerComposition(composition, opts)` | 手动图层清单（精细控制）|

**模块**：`types` / `parse` / `variables` / `standalone` / `mainLayer` / `compose` / `codec` / `prerender` / `render` / `parity`

**关键特性**：
- 透明资产 ProRes 4444 MOV（规避 gyan.dev VP9 alpha 在 scale 下丢失的坑）
- GPU 硬件加速（`detectGpuEncoder` → h264_amf/nvenc/qsv/videotoolbox，vaapi 回退软件）
- 音频 copy（第一音轨 AAC → `-c:a copy`）
- 模板占位符替换（`__VIDEO_SRC__` / `__VIDEO_DURATION__` 等 4 种形态）
- 主层渲染（吸收主 timeline 幕布/运动 a-roll/音频）
- 进度回调（`{progress, stage}`，对齐 studio RenderJobState）

**验证**：43/43 单测 + typecheck + lint 全绿；vignelli 端到端 PSNR 29–31dB（超/接近官方 30dB 阈值）

### 2. CLI 集成

- `packages/cli/src/commands/layer-render.ts` — `hyperframes layer-render index.html -o out.mp4 --fps 30`
- `packages/cli/src/cli.ts` — 命令注册
- `packages/cli/package.json` — devDependencies 加 `@hyperframes/ffmpeg-layer-renderer`

### 3. Studio 集成

- "Export with FFmpeg" 按钮（`engine: "layer"` 走图层化渲染）
- 涉及：`studio-server/src/types.ts`、`routes/render.ts`、`cli/src/server/studioServer.ts`、`studio/src/components/renders/RenderQueue.tsx`、`useRenderQueue.ts`、`StudioRightPanel.tsx`

### 4. Skill 补丁分发

- `packages/ffmpeg-layer-renderer/skills-patch/fragments.md` — 3 个片段（锚点 + 操作 + 幂等）
- `packages/ffmpeg-layer-renderer/skill/SKILL.md` — `ffmpeg-layer-render-skill-patch`，指导 agent 把片段合并进官方 `hyperframes-cli` skill

## 关于"独立插件/独立发布"的说明

**当前不可行**（结构性原因，非工程技巧能绕过）：

1. Hyperframes CLI 无运行时插件加载机制（命令编译期硬编码）。
2. 依赖链深且交织（producer → core/parsers/lint/studio-server/…），无法单文件打包或独立二进制分发。
3. "下载二进制"不适用（TS 包 + 运行时依赖 ffmpeg/Chromium）。

**要正式发布需走官方流程**：①提交 PR 合入本仓库 ②维护者把包加进 `.github/workflows/publish.yml` 发布列表 ③打 tag 触发 CI（`pnpm pack` + `pnpm publish`）。

## 本地/团队内试用方式（无需发布）

```bash
# 直接跑 CLI（monorepo 内）
bun packages/cli/src/cli.ts layer-render index.html -o out.mp4 --fps 30

# 或跑验收脚本
PRODUCER_HEADLESS_SHELL_PATH=<chrome> bun packages/ffmpeg-layer-renderer/scripts/verify-vignelli-render.ts
```

## 规划文档

- `plans/ffmpeg-layer-renderer/README.md` — 总索引
- `plans/ffmpeg-layer-renderer/progress.md` — 完整时间线（Phase 1-9）
- `plans/ffmpeg-layer-renderer/findings.md` — 架构决策与坑
