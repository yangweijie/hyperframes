# Progress Log

## 2026-08-17 — layer-render 端到端打通并落盘

### Session 1（历史，已 summary 记录）

- 注册 layer-render 命令、修复 compose format、加 ensureGsapAsset、扩展 LayerRenderResult、修正子组件为 template 片段。
- 用 Edge 替代失败的 chrome-headless-shell。
- 首次渲染成功：out.mp4（1080×1920@30fps，3 层），prerender 81712ms + composite 2522ms。

### Session 2（本次）

- 用户重跑命令发现 overlay format=yuva420p 错误复现 → 根因：compose.ts 的 format=auto 修复未重新 bundle 进 dist/cli.js。
- `npx tsup --no-clean` 重建 CLI → 验证 bundle 内 overlay 已是 format=auto。
- 重跑渲染成功：
  - output: D:\git\web\hyperframes\product-launch\out.mp4
  - layers cut: 3 (1 background + 2 transparent overlay)
  - prerender total: 108934ms
  - composite: 2883ms
  - grand total: 111817ms
- 应要求给 ffmpeg-layer-renderer README 新增「生成对比报告」章节（耗时取数 + PSNR parity + 汇总表）。

### Session 3（提交）

- 用户尝试以 `修复报错` 提交 → commit-msg hook 的 commitlint 拦截（subject-empty / type-empty）。
- 改用 `feat(cli): add layer-render ffmpeg compositing command`（-m 多段）。
- 所有 lefthook 检查通过（lint/format/fallow/typecheck/commitlint/largefiles）。
- 提交成功：`[main 488f60d] ... 13 files changed, 405 insertions(+), 62 deletions(-)`。

### Session 4 — studioServer 浏览器启动修复（preview 路径）

- 用户改用 `hyperframes preview packages/ffmpeg-layer-renderer/intro --port 3002` 导出，layer 分支报 `Failed to launch the browser process: Code: 3221225595` (0xC000007B)。
- 根因：`studioServer.ts` 的 `findSystemChromium` 被声明为 `async function` 但体内无异步，顶部 `const systemChromium = findSystemChromium();`（未 await）拿到 Promise，`if (systemChromium)` 恒真 → 把 `"[object Promise]"` 赋给 `PRODUCER_HEADLESS_SHELL_PATH` → layer 分支 `if (!process.env...)` 跳过回退，用损坏的 managed chrome 路径。
- 修复：① 去掉 `async`（改同步函数）；② 在 `createStudioServer` 顶部无条件探测系统浏览器并提前设 env（在 `resolveLocalBrowserGpuMode()` 之前）。
- `vite.browser.ts` 的 win32 systemChromePaths 也补了 Edge 候选（dev server 路径，非本次主路径但保留）。
- 重建 cli/dist 验证：Edg/148.0.3967.54 启动成功，用户确认"能导出了"。

### Session 5 — 进度上报修复（前端卡 5%）

- 现象：导出时前端进度条卡 5%。根因：`render-main-layer` 阶段只发一次 `progress:5`，producer 逐帧进度（capture 25→70%）未透传。
- 修复三处（均在 ffmpeg-layer-renderer 包，改后需重建 cli/dist）：
  - `prerender.ts`：`renderHtmlToMedia` 加 `onProgress?: (progress:number)=>void`，透传给 `executeRenderJob`。
  - `prerender.ts`：`renderMainLayer` 加 `onProgress` 参数并透传。
  - `render.ts`：`render-main-layer` 分支映射 `5 + producerProgress/100*15` → layer pipeline 的 5–20%。
- 重建验证：capture 帧推进（170/1920）正常，progressSink 被调用。

### Session 6 — 偶发 "Connection lost" 根因 = 并发 worker OOM

- 现象：渲染能成功（renders 目录多次 `complete`），但偶发"导了一会连接断开" → 前端 "Connection lost. Is the render server running?"。
- 判断：studioServer 的 `startRender` 有完整 try/catch，异常会写 state.failed 并让 SSE 正常关闭；只有**整个 Node 进程崩溃**才表现为"连接断开"（而非"渲染失败"）。
- 加进程级 `uncaughtException`/`unhandledRejection` 处理器（studioServer.ts 顶部，打印到 stderr）——但 OOM 是系统杀进程不抛 JS 异常，本次未触发，也抓不到 OOM。
- 真正根因：`renderHtmlToMedia` 之前**未传 workers**，producer 走 `computeWorkerSizing` 的 `auto` → 本机被算成 **6 个并发 Chrome 进程**（SwiftShader 软件渲染，每进程 ~1.5GB，代码 `MEMORY_PER_WORKER_MB=1536`；注释记过旧 256MB 估算低 6 倍，曾致 16GB 黑屏、24GB 6-worker 堆 OOM）。峰值内存 + ffmpeg 把进程撑爆 → 系统杀进程 → 连接断。`parallelCoordinator.ts` 注释已记 `ts=1784042064` 该 Windows render capture 阶段 hard-exit，建议 `--workers=1` 隔离。
- 修复：`prerender.ts` 的 `renderHtmlToMedia` 注入 `workers`，默认从 `HF_LAYER_WORKERS` 读取、**默认 1（串行最稳）**；设 `HF_LAYER_WORKERS=N` 可恢复并行。已重建 cli/dist，无 lint 错误。

### Status: ALL COMPLETE（截至 2026-08-17）

- Phase 1-7 + Session 4-6 全部完成。
- 待办/可后续：
  - 若串行后仍偶发断开，需用户附 `[Studio]` 终端报错或 Windows 事件查看器 Chrome/OOM 记录，排查是否另有根因。
  - 可选：在 ffmpeg-layer-renderer 文档/启动脚本固化 `HF_LAYER_WORKERS` 默认值；或在包内直接 bundle gsap。
