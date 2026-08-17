/**
 * Top-level orchestration: pre-render dynamic layers → composite via ffmpeg.
 */

import { runFfmpeg } from "@hyperframes/engine";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { buildCompositeArgs } from "./compose.js";
import { resolveCompositeCodec } from "./codec.js";
import { buildMainLayerHtml, needsMainLayerRender } from "./mainLayer.js";
import { parseLayerSpecs } from "./parse.js";
import { prerenderLayer, renderMainLayer } from "./prerender.js";
import { hasTemplate, materializeStandalone } from "./standalone.js";
import { substituteVariables, type VariableMap } from "./variables.js";
import type {
  LayerComposition,
  LayerRenderResult,
  LayerSummary,
  PrerenderResult,
  RenderProgressCallback,
} from "./types.js";

export interface RenderLayerCompositionOptions {
  /** Absolute path to the composition project directory. */
  projectDir: string;
  /** Directory to write intermediate assets into (transparent per-layer assets). */
  workDir: string;
  /** Final composite output path. */
  outputPath: string;
  fps: number;
  /**
   * Container used for the per-layer transparent assets. Defaults to `mov`
   * (ProRes 4444) — see `prerender.ts` for the gyan.dev VP9-alpha caveat.
   */
  prerenderFormat?: "mov" | "webm";
  /**
   * Output codec for the final composite. Defaults to `libx264`. Choose
   * `libvpx-vp9` only if you also prerender with `webm` and your ffmpeg
   * build handles VP9 alpha through `overlay` reliably.
   */
  codec?: "libvpx-vp9" | "libx264";
  log?: (message: string) => void;
  /**
   * Progress callback. Pre-render stages span 0–85% (shared across layers),
   * the composite stage 85–100%.
   */
  onProgress?: RenderProgressCallback;
}

/**
 * Render a layer composition: pre-render each dynamic/loop/static layer once
 * as a transparent asset, then composite background + layers with a single
 * ffmpeg `overlay` filtergraph.
 */
export async function renderLayerComposition(
  composition: LayerComposition,
  options: RenderLayerCompositionOptions,
): Promise<LayerRenderResult> {
  const { projectDir, workDir, outputPath, fps } = options;
  const log = options.log ?? (() => {});
  const onProgress = options.onProgress ?? (() => {});
  const assetsDir = join(workDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  // Materialized sub-compositions inject a relative `gsap.min.js` next to the
  // standalone HTML (written into `projectDir`). Ensure the real file is present
  // there so the pre-render browser can load it (the package does not bundle gsap).
  ensureGsapAsset(projectDir);

  // Pre-render each layer that needs capturing (dynamic / loop / static).
  const prerenderStart = Date.now();
  const prerendered: PrerenderResult[] = [];
  const layersToPrerender = composition.layers.filter((layer) => layer.kind !== "background");
  const totalLayers = layersToPrerender.length || 1;
  for (const [index, layer] of layersToPrerender.entries()) {
    onProgress({
      progress: Math.round((index / totalLayers) * 85),
      stage: `prerender:${layer.id}`,
    });
    prerendered.push(
      await prerenderLayer(layer, {
        projectDir,
        assetsDir,
        fps,
        format: options.prerenderFormat,
        log,
      }),
    );
  }
  const prerenderMs = Date.now() - prerenderStart;

  // Resolve asset paths in `composition.layers` order (background excluded —
  // it is passed as `mediaPath` directly, not pre-rendered here).
  const assetPaths: string[] = [];
  const byId = new Map(prerendered.map((r) => [r.layerId, r.assetPath]));
  for (const layer of composition.layers) {
    if (layer.kind === "background") continue;
    const path = byId.get(layer.id);
    if (!path) throw new Error(`Missing pre-rendered asset for layer "${layer.id}"`);
    assetPaths.push(path);
  }

  // Composite.
  const compositeCodec = await resolveCompositeCodec({
    codec: options.codec,
    backgroundMediaPath: composition.background.mediaPath || undefined,
    carryAudio: composition.background.carryAudio,
  });
  const args = buildCompositeArgs(composition, assetPaths, outputPath, compositeCodec);
  log(`[ffmpeg-layer-renderer] composite ${composition.layers.length} layer(s) → ${outputPath}`);
  onProgress({ progress: 85, stage: "composite" });
  const compositeStart = Date.now();
  const result = await runFfmpeg(args);
  const compositeMs = Date.now() - compositeStart;
  onProgress({ progress: 100, stage: "complete" });

  if (!result.success) {
    throw new Error(`FFmpeg composite failed (exit ${result.exitCode}): ${result.stderr}`);
  }

  const layers: LayerSummary[] = [
    {
      role: "background",
      source: composition.background.htmlPath || composition.background.mediaPath,
      id: "background",
    },
    ...composition.layers.map((layer) => ({
      role: layer.kind,
      source: layer.htmlPath ?? "",
      id: layer.id,
    })),
  ];

  return {
    outputPath,
    compositeMs,
    prerenderMs,
    layers,
    scaleMode: "fit",
  };
}

export interface RenderCompositionFromHtmlOptions {
  /** Absolute path to the composition project directory. */
  projectDir: string;
  /** Directory to write intermediate assets (standalone HTML + layer assets). */
  workDir: string;
  /** Final composite output path. */
  outputPath: string;
  fps: number;
  /**
   * Local gsap.min.js path, relative to each materialized standalone document.
   * Only needed when sub-compositions use the `<template>` wrapper and require
   * a GSAP runtime. Defaults to `gsap.min.js` (expects the file next to the
   * materialized HTML).
   */
  gsapRelativePath?: string;
  prerenderFormat?: "mov" | "webm";
  codec?: "libvpx-vp9" | "libx264";
  /**
   * Templating placeholder values, e.g. `{ "__VIDEO_SRC__": "a-roll.mp4",
   * "__VIDEO_DURATION__": "10.24" }`. Substituted before parsing so
   * placeholders don't parse as `NaN` durations / unresolved sources.
   */
  variables?: VariableMap;
  log?: (message: string) => void;
  /**
   * Progress callback. Overall pipeline: parse/substitute 0–2%, materialize
   * 2–5%, main-layer render 5–20% (when present), pre-render 20–95% (shared
   * across layers), composite 95–100%.
   */
  onProgress?: RenderProgressCallback;
}

/**
 * High-level entry: parse a Hyperframes host composition (`index.html`) into
 * layers, materialize any `<template>` sub-compositions into standalone HTML,
 * then render the layer composition via `renderLayerComposition`.
 *
 * This is the "automatic HTML splitting" path — no hand-authored layer list
 * required. It reads the same `data-composition-src` structure the producer's
 * render path already consumes.
 */
export async function renderCompositionFromHtml(
  htmlPath: string,
  options: RenderCompositionFromHtmlOptions,
): Promise<LayerRenderResult> {
  const { projectDir, workDir, outputPath, fps } = options;
  const log = options.log ?? (() => {});
  const onProgress = options.onProgress ?? (() => {});
  let html = readFileSync(htmlPath, "utf-8");

  onProgress({ progress: 0, stage: "parse" });

  // 0. Substitute templating placeholders before parsing, so `data-duration`
  //    and media `src` values resolve to real numbers/URLs.
  if (options.variables) {
    html = substituteVariables(html, options.variables);
  }

  // 1. Split the host into layers (background + sub-compositions).
  const { composition } = parseLayerSpecs(html, { projectDir, fps });
  onProgress({ progress: 2, stage: "parse" });

  // 2. Materialize any `<template>` sub-compositions into standalone HTML.
  // The standalone files are written into projectDir (as `standalone-<id>.html`)
  // so `layer.htmlPath` stays a simple projectDir-relative path that the
  // producer's `entryFile` resolution understands.
  for (const layer of composition.layers) {
    if (!layer.htmlPath) continue;
    const srcAbs = resolve(projectDir, layer.htmlPath);
    if (hasTemplate(srcAbs)) {
      // Sanitize the layer id so it can't inject path separators into the
      // materialized filename (layer ids come from host HTML attributes).
      const safeId = layer.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const standalonePath = resolve(projectDir, `standalone-${safeId}.html`);
      materializeStandalone({
        filePath: srcAbs,
        gsapRelativePath: options.gsapRelativePath ?? "gsap.min.js",
        outputPath: standalonePath,
        variables: options.variables,
      });
      layer.htmlPath = `standalone-${safeId}.html`;
      log(`[ffmpeg-layer-renderer] materialized "${layer.id}" → ${standalonePath}`);
    }
  }
  onProgress({ progress: 5, stage: "materialize" });

  // 3. If the host has main-timeline content beyond bare media (curtain
  //    transitions, a-roll opacity, …), render the host-minus-subcomps as an
  //    opaque background video. This absorbs gaps #2 (curtain) and #3 (moving
  //    a-roll) and carries the audio track (#4).
  if (needsMainLayerRender(html)) {
    const mainLayerHtmlPath = resolve(projectDir, "__main-layer__.html");
    writeFileSync(mainLayerHtmlPath, buildMainLayerHtml(html), "utf-8");
    log(`[ffmpeg-layer-renderer] main layer detected → ${mainLayerHtmlPath}`);
    onProgress({ progress: 5, stage: "render-main-layer" });
    composition.background.mediaPath = await renderMainLayer(
      "__main-layer__.html",
      projectDir,
      resolve(workDir, "assets"),
      fps,
      log,
      // Map the producer's 0–100 (compile 5 → capture 25–70 → encode 75 →
      // done 100) onto this pipeline's 5–20% main-layer band.
      (producerProgress) =>
        onProgress({
          progress: 5 + Math.round((producerProgress / 100) * 15),
          stage: "render-main-layer",
        }),
    );
  }

  // 4. Render. Map the sub-renderer's 0–100 onto this pipeline's 20–100.
  onProgress({ progress: 20, stage: "prerender" });
  return renderLayerComposition(composition, {
    projectDir,
    workDir: resolve(workDir),
    outputPath,
    fps,
    prerenderFormat: options.prerenderFormat,
    codec: options.codec,
    log,
    onProgress: (update) =>
      onProgress({
        progress: 20 + Math.round(update.progress * 0.8),
        stage: update.stage,
      }),
  });
}

/**
 * Find the real gsap.min.js on disk (the package does not bundle it) and copy
 * it into `dir` so materialized sub-compositions can load it via a relative
 * `gsap.min.js` reference. Walks up from `dir` toward the filesystem root,
 * checking the bun and npm `node_modules` layouts.
 */
function ensureGsapAsset(dir: string): void {
  const dest = join(dir, "gsap.min.js");
  if (existsSync(dest)) return;

  let cursor = resolve(dir);
  for (;;) {
    const candidates = [
      join(cursor, "node_modules", "gsap", "dist", "gsap.min.js"),
      join(cursor, "node_modules", ".bun", "gsap", "dist", "gsap.min.js"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        copyFileSync(candidate, dest);
        return;
      }
    }
    // bun caches gsap under node_modules/.bun/gsap@<ver>/node_modules/gsap/dist
    const bunRoot = join(cursor, "node_modules", ".bun");
    if (existsSync(bunRoot)) {
      for (const entry of readdirSync(bunRoot)) {
        const candidate = join(bunRoot, entry, "node_modules", "gsap", "dist", "gsap.min.js");
        if (existsSync(candidate)) {
          copyFileSync(candidate, dest);
          return;
        }
      }
    }

    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
