# Findings

## 关键发现

### 1. CLI bundle 与包源码分离

- `packages/cli` 用 tsup 把 `@hyperframes/ffmpeg-layer-renderer` **bundle** 进 `dist/cli.js`。
- 普通 `npx tsup` 会被 CodeBuddy safe-delete 拦截（删 dist），必须用 `npx tsup --no-clean`。
- **任何对 ffmpeg-layer-renderer 包的源码修改，都必须重新 bundle CLI 才生效**（最隐蔽的坑：compose.ts 改了但 dist 仍是旧代码，导致 overlay format 报错复现）。

### 2. ffmpeg overlay 滤镜 format 枚举

- overlay 的 `format` 选项不支持 `yuva420p`（会被当成表达式解析报错 "Undefined constant"）。
- 正确做法：`format=auto`，ffmpeg 内部在前景带 alpha 时自动用 yuva420p。
- scale 滤镜的 `format=yuva420p` 是合法的（scale 支持该像素格式枚举）。

### 3. 浏览器环境（Windows）

- hyperframes 缓存的 chrome-headless-shell 本机启动失败（0xC000007B，缺运行库）。
- 用户明确指示先 `hyperframes browser ensure` 再判断是卡住还是帧率问题 → 确认与帧率无关，是浏览器二进制问题。
- 替代方案：系统 Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` 经 `PRODUCER_HEADLESS_SHELL_PATH` 注入。

### 4. 环境变量（每次新 shell 需重设，属 workaround）

- `PRODUCER_HYPERFRAME_MANIFEST_PATH` → core/dist/hyperframe.manifest.json
- `PRODUCER_HEADLESS_SHELL_PATH` → Edge 可执行文件

### 5. gsap 不随包 bundle

- ffmpeg-layer-renderer 包不打包 gsap，需 `ensureGsapAsset` 从 node_modules/.bun 复制 gsap.min.js 到 projectDir 供 materialized standalone HTML 引用。

### 6. 子组件规范

- 子组件须用 `<template id="x-template">` 包裹片段，根 div 带 `data-duration`，用全局 `gsap` 写 timeline 注册到 `window.__timelines`。

### 7. commitlint 规范

- 提交信息必须是 `<type>: <subject>`（feat/fix/docs/refactor/test），纯中文无 type 会失败。
- 输出中 fallow 的 `WARN unknown suppression issue kind` 是配置未识别 issue kind，不影响检查通过。

### 8. studioServer 浏览器探测的 async/Promise 陷阱（preview 路径）

- `studioServer.ts` 的 `findSystemChromium` 原是 `async function`（体内无 await），顶部 `const systemChromium = findSystemChromium();` 未 await 拿到 Promise，`if (systemChromium)` 恒真 → `"[object Promise]"` 被赋给 `PRODUCER_HEADLESS_SHELL_PATH` → layer 分支跳过回退用损坏路径。
- 修复：改为同步函数 + 在 `createStudioServer` 顶部无条件探测并提前设 env。改后 cli/dist 必须重建。

### 9. layer 渲染默认并发 worker 导致 OOM（Connection lost 根因）

- `renderHtmlToMedia` 未传 `workers`，producer `computeWorkerSizing` 的 `auto` 在本机算成 6 个并发 Chrome（SwiftShader ~1.5GB/进程，`MEMORY_PER_WORKER_MB=1536`）。
- 峰值内存 + ffmpeg 撑爆进程，系统杀进程 → 前端 "Connection lost"。该崩溃不抛 JS 异常，进程级 handler 抓不到。
- 修复：`prerender.ts` 注入 `workers`，默认 `HF_LAYER_WORKERS=1`（串行最稳），可设 `HF_LAYER_WORKERS=N` 恢复并行。
- `createRenderRequest({options:{workers}})` 是合法字段，`renderConfigFromRequest` 会映射到 `job.config.workers` 并被 producer 尊重。

### 10. 进度上报链路（studioServer ↔ producer ↔ 前端）

- `RenderProgressCallback = (update:{progress,stage}) => void`；producer `ProgressCallback=(job,message)=>void`，`job.progress` 每 30 帧更新（capture 25→70%，encode 70→95%）。
- studioServer 的 onProgress 应 `state.progress = update.progress; if(update.stage) state.stage = update.stage`。layer 分支需手动映射 producer 进度到 pipeline 区间（主层 5→20%）。

## 验证数据

- 渲染输出：1080×1920@30fps，240 帧，3 层（1 背景 + 2 overlay）
- prerender=108934ms, composite=2883ms, total=111817ms
- commit: 488f60d (feat(cli): add layer-render ffmpeg compositing command)
