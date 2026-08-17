/**
 * Pre-render a single dynamic layer's HTML into a transparent asset, and
 * render a main-layer HTML into an opaque background video.
 *
 * Reuses @hyperframes/producer's `executeRenderJob`. Transparent layers use
 * `format: "mov"` (ProRes 4444 → true alpha) — we validated in
 * plans/spike/vignelli-render-findings.md that the gyan.dev ffmpeg build
 * corrupts VP9 alpha during the `scale` filter. The opaque main layer uses
 * `mp4` (H.264), which also carries the audio track.
 */

import {
  createRenderJob,
  createRenderRequest,
  executeRenderJob,
  renderConfigFromRequest,
  resolveConfig,
} from "@hyperframes/producer";
import { join } from "path";
import type { LayerSpec, PrerenderResult } from "./types.js";

export interface PrerenderOptions {
  /** Absolute path to the composition project directory. */
  projectDir: string;
  /** Directory to write pre-rendered assets into. */
  assetsDir: string;
  fps: number;
  /**
   * Asset container / codec. Defaults to `mov` (ProRes 4444) — see the
   * note above for why. Set to `webm` only if you've validated that VP9
   * alpha behaves correctly on your ffmpeg build.
   */
  format?: "mov" | "webm";
  /** Forwarded to the producer logger for observability. */
  log?: (message: string) => void;
}

/**
 * Render an HTML entry to a media file via the producer. This is the single
 * producer-call site shared by transparent layer pre-render and opaque
 * main-layer render, so both paths stay pixel-identical to the CLI.
 */
export async function renderHtmlToMedia(
  entryFile: string,
  projectDir: string,
  outputPath: string,
  fps: number,
  format: "mov" | "webm" | "mp4",
  onProgress?: (progress: number) => void,
): Promise<void> {
  // Layer renders run inside the studio/preview server process alongside ffmpeg
  // and the parent V8 heap. Under `auto` worker sizing the producer launches
  // several concurrent Chrome processes (SwiftShader, ~1.5 GB each), whose peak
  // RSS plus the encoder can exhaust memory and hard-exit the whole process —
  // surfacing to the browser as "Connection lost" mid-export. Default to a
  // single serial worker (lowest memory, most stable) for the layer path; opt
  // back into parallelism with HF_LAYER_WORKERS=N if the host has headroom.
  const layerWorkers = (() => {
    const raw = process.env.HF_LAYER_WORKERS;
    if (raw === undefined || raw === "") return 1;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  })();

  const request = createRenderRequest({
    projectDir,
    outputPath,
    options: {
      fps: { num: fps, den: 1 },
      quality: "standard",
      format,
      entryFile,
      strictness: "best-effort",
      workers: layerWorkers,
    },
    engineConfig: resolveConfig({ browserGpuMode: "software" }),
  });
  const config = renderConfigFromRequest(request);
  const job = createRenderJob(config);
  await executeRenderJob(
    job,
    projectDir,
    outputPath,
    onProgress ? (j) => onProgress(j.progress) : undefined,
  );
}

/**
 * Pre-render one layer to a transparent asset.
 *
 * The layer's `htmlPath` is treated as the composition entry file (relative
 * to `projectDir`), the same way the CLI's `-c <composition>` works. The
 * layer is rendered for its own `duration` (a loop layer may be authored
 * shorter than its visibility window and replayed by `loop` at composite).
 */
export async function prerenderLayer(
  layer: LayerSpec,
  options: PrerenderOptions,
): Promise<PrerenderResult> {
  if (!layer.htmlPath) {
    throw new Error(
      `Layer "${layer.id}" has no htmlPath; only dynamic/static layers can be pre-rendered.`,
    );
  }

  const format = options.format ?? "mov";
  const ext = format === "mov" ? "mov" : "webm";
  const assetPath = join(options.assetsDir, `${layer.id}.${ext}`);

  const log = options.log ?? (() => {});
  log(`[ffmpeg-layer-renderer] pre-render layer "${layer.id}" → ${assetPath}`);
  await renderHtmlToMedia(layer.htmlPath, options.projectDir, assetPath, options.fps, format);

  return {
    layerId: layer.id,
    assetPath,
    assetDuration: layer.duration,
  };
}

/**
 * Render a main-layer HTML (host minus sub-compositions) to an opaque
 * background video (H.264 MP4, audio included).
 */
export async function renderMainLayer(
  mainLayerHtmlPath: string,
  projectDir: string,
  assetsDir: string,
  fps: number,
  log: (message: string) => void,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const outputPath = join(assetsDir, "main-layer.mp4");
  log(`[ffmpeg-layer-renderer] render main layer → ${outputPath}`);
  await renderHtmlToMedia(mainLayerHtmlPath, projectDir, outputPath, fps, "mp4", onProgress);
  return outputPath;
}
