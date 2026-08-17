# Task Plan: Hyperframes `layer-render` ffmpeg 加速渲染

## Goal

用 Hyperframes 的 ffmpeg 加速渲染（`layer-render`）生成产品发布视频，打通端到端链路并落盘为可复用能力。组合采用图层结构：1 个静态背景 + 至少 2 个 `<template>` 子组件（overlays + captions），只走 `npx hyperframes layer-render` 路径。

## Phases

### Phase 1 — 注册 layer-render 命令

- 新建 `packages/cli/src/commands/layer-render.ts`
- 在 `packages/cli/src/cli.ts` 的 commandLoaders 注册
- `packages/cli/package.json` 加 `@hyperframes/ffmpeg-layer-renderer` workspace 依赖
- `npx tsup --no-clean` 重建 CLI（bundle 进 dist/cli.js）
- **status: complete**

### Phase 2 — 打通渲染环境

- `bun run build` 生成 core manifest
- 设 `PRODUCER_HYPERFRAME_MANIFEST_PATH` 环境变量
- 浏览器：chrome-headless-shell 本机启动失败 (0xC000007B)，改用 Edge 经 `PRODUCER_HEADLESS_SHELL_PATH` 注入
- **status: complete**

### Phase 3 — 修复 compose.ts overlay format bug

- overlay 滤镜 `format=yuva420p` 被 ffmpeg 拒绝 → 改为 `format=auto`（保留 alpha）
- scale 滤镜的 `format=yuva420p` 保留（正确）
- 关键：改包源码后必须 `npx tsup --no-clean` 重建 CLI，否则 dist 仍是旧代码
- **status: complete**

### Phase 4 — gsap 资产 + 子组件规范

- `render.ts` 新增 `ensureGsapAsset(projectDir)` 复制真实 gsap.min.js
- 子组件改为 `<template id="x-template">` 片段 + `data-duration`
- 扩展 `LayerRenderResult` 加 `layers` / `scaleMode`，报告用 c.success/c.cyan
- **status: complete**

### Phase 5 — 渲染成功 + 报告

- out.mp4 生成（1080×1920@30fps，3 层）
- 报告指标：layers cut=3, prerender=108934ms, composite=2883ms, total=111817ms
- **status: complete**

### Phase 6 — README 对比报告章节

- `packages/ffmpeg-layer-renderer/README.md` 新增「生成对比报告」：耗时取数 + PSNR parity + 汇总表
- **status: complete**

### Phase 7 — 提交

- 原信息 `修复报错` 被 commitlint 拦截（缺 type）
- 改用 `feat(cli): add layer-render ffmpeg compositing command`
- commit `488f60d` 成功，13 files changed
- **status: complete**

### Phase 8 — studioServer 浏览器启动修复（preview 路径）

- `findSystemChromium` 原为 async（体内无 await），顶部未 await 把 Promise 赋给 `PRODUCER_HEADLESS_SHELL_PATH` → layer 分支跳过回退用损坏路径。
- 修复：去 async + `createStudioServer` 顶部无条件探测系统浏览器提前设 env。
- 重建 cli/dist 验证：Edg/148.0.3967.54 启动，用户确认"能导出了"。
- **status: complete**

### Phase 9 — 进度上报修复

- 前端进度条卡 5%：render-main-layer 阶段未透传 producer 逐帧进度。
- 修复：`prerender.ts` 透传 `onProgress`；`render.ts` 主层映射 producer 进度到 5–20%。
- **status: complete**

### Phase 10 — 偶发 Connection lost（并发 worker OOM）

- 根因：`renderHtmlToMedia` 未传 workers，producer auto 算成 6 并发 Chrome 进程，峰值内存被系统杀进程。
- 修复：`prerender.ts` 注入 `workers`，默认 `HF_LAYER_WORKERS=1`（串行最稳），可设 N 恢复并行。
- **status: complete**

## Errors Encountered

| Error                        | Attempt | Resolution                                                      |
| ---------------------------- | ------- | --------------------------------------------------------------- |
| layer-render 命令未注册      | 1       | 新建命令文件 + 注册 + 加依赖 + tsup 重建                        |
| core manifest 缺失           | 1       | bun run build + 设 PRODUCER_HYPERFRAME_MANIFEST_PATH            |
| 浏览器启动失败 0xC000007B    | 1       | 改用 Edge 经 PRODUCER_HEADLESS_SHELL_PATH                       |
| overlay format=yuva420p 非法 | 1       | format=auto；并重建 CLI bundle                                  |
| 子组件 gsap 404 / 零时长     | 1       | ensureGsapAsset + template 片段 + data-duration                 |
| LayerRenderResult 缺 layers  | 1       | 扩展类型与返回                                                  |
| 报告 c.green 不存在          | 1       | 改用 c.success                                                  |
| 短旗 -o 未识别               | 1       | args 加 alias: "o"/"f"                                          |
| commit-msg commitlint 失败   | 1       | 改用 conventional commits 格式                                  |
| preview layer 0xC000007B     | 1       | findSystemChromium 去 async + 顶部提前设 env；重建 dist         |
| 进度卡 5%                    | 1       | render.ts 主层映射 producer 进度 + prerender 透传 onProgress    |
| 偶发 Connection lost (OOM)   | 1       | prerender 注入 workers，默认 HF_LAYER_WORKERS=1 串行；重建 dist |
