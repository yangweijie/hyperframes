/**
 * Parse a Hyperframes host composition into a layer composition spec.
 *
 * Hyperframes already marks layers via `data-composition-src`: each host
 * element with that attribute is a self-contained sub-composition (a layer)
 * with its own `data-composition-id`, `data-start`, `data-duration`, and
 * `data-track-index`. Media elements (`<video>` / `<audio>`) inside the host
 * that are NOT sub-compositions form the background layer.
 *
 * This is the automatic counterpart to the manual `LayerSpec[]` the MVP asked
 * callers to assemble by hand — it reads the same structure the render path
 * (`parseSubCompositions` in @hyperframes/producer) already consumes, so a
 * real multi-layer composition (e.g. `vignelli-stacking`) drops straight in.
 */

import { parseHTML } from "linkedom";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BackgroundSpec,
  LayerComposition,
  LayerSpec,
  OverlayBlendMode,
} from "./types.js";

export interface ParseLayerSpecsOptions {
  /** Absolute path to the composition project directory. */
  projectDir: string;
  /** Frames per second of the output. */
  fps: number;
}

/** Result of parsing a host HTML into a layer composition. */
export interface ParseLayerSpecsResult {
  composition: LayerComposition;
  /** Sub-composition hosts that were skipped (missing src / empty). */
  skipped: Array<{ src: string; reason: string }>;
}

const COMPOSITION_HOST_SELECTOR = "[data-composition-src]";
const MEDIA_SELECTOR = "video[src], video[data-src], audio[src]";

interface HostInfo {
  spec: LayerSpec;
  trackIndex: number;
}

/**
 * Parse a host composition's HTML into a `LayerComposition`.
 *
 * Layers are ordered by `data-track-index` (ascending), so later tracks
 * composite on top of earlier ones. The background is derived from the first
 * media element that is NOT a sub-composition host.
 */
export function parseLayerSpecs(
  html: string,
  options: ParseLayerSpecsOptions,
): ParseLayerSpecsResult {
  const { document } = parseHTML(html);
  const skipped: ParseLayerSpecsResult["skipped"] = [];

  // 1. Sub-composition hosts → dynamic layers.
  const hosts = Array.from(
    document.querySelectorAll<Element>(COMPOSITION_HOST_SELECTOR),
  );
  const hostInfos: HostInfo[] = [];

  for (const host of hosts) {
    const src = host.getAttribute("data-composition-src")?.trim();
    if (!src) {
      skipped.push({ src: "", reason: "empty data-composition-src" });
      continue;
    }
    const id =
      host.getAttribute("data-composition-id")?.trim() ||
      host.getAttribute("id")?.trim() ||
      src;

    const start = parseFloat(host.getAttribute("data-start") ?? "0");
    const duration = parseFloat(host.getAttribute("data-duration") ?? "0");
    const trackIndex = parseInt(
      host.getAttribute("data-track-index") ?? "0",
      10,
    );

    const spec: LayerSpec = {
      id,
      htmlPath: src,
      start: Number.isFinite(start) ? start : 0,
      duration: Number.isFinite(duration) ? duration : 0,
      kind: "dynamic",
    };

    if (host.hasAttribute("data-x")) spec.x = parseFloat(host.getAttribute("data-x")!);
    if (host.hasAttribute("data-y")) spec.y = parseFloat(host.getAttribute("data-y")!);
    const blend = normalizeBlend(host.getAttribute("data-blend"));
    if (blend) spec.blend = blend;

    hostInfos.push({ spec, trackIndex: Number.isFinite(trackIndex) ? trackIndex : 0 });
  }

  // 2. Sort by track index (stable ascending).
  hostInfos.sort((a, b) => a.trackIndex - b.trackIndex);

  // 3. Background media: first media element that is not a sub-composition.
  const media = Array.from(
    document.querySelectorAll<Element>(MEDIA_SELECTOR),
  ).find((el) => !el.closest(COMPOSITION_HOST_SELECTOR));

  const width = parseFloat(
    document.querySelector("[data-width]")?.getAttribute("data-width") ?? "1920",
  );
  const height = parseFloat(
    document.querySelector("[data-height]")?.getAttribute("data-height") ?? "1080",
  );
  const duration = parseFloat(
    document.querySelector("[data-duration]")?.getAttribute("data-duration") ?? "0",
  );

  const background: BackgroundSpec = {
    // Background is optional — a composition may have no media background.
    mediaPath: media
      ? (media.getAttribute("src") ?? media.getAttribute("data-src") ?? "")
      : "",
    width: Number.isFinite(width) ? width : 1920,
    height: Number.isFinite(height) ? height : 1080,
    fps: options.fps,
    duration: Number.isFinite(duration) ? duration : 0,
  };

  // Resolve the background media path relative to the project dir; leave as-is
  // when it is an absolute URL (remote media) or already absolute.
  if (
    background.mediaPath &&
    !/^(https?:|\/|[a-zA-Z]:)/.test(background.mediaPath)
  ) {
    background.mediaPath = resolve(options.projectDir, background.mediaPath);
  }

  return {
    composition: {
      background,
      layers: hostInfos.map((info) => info.spec),
    },
    skipped,
  };
}

/** Normalize a blend attribute string to a valid overlay blend mode. */
export function normalizeBlend(
  value: string | null | undefined,
): OverlayBlendMode | undefined {
  const mode = (value ?? "").trim().toLowerCase();
  switch (mode) {
    case "screen":
    case "multiply":
    case "overlay":
    case "add":
      return mode;
    default:
      return undefined;
  }
}

/** Whether the given sub-composition src resolves to an existing file. */
export function layerAssetExists(projectDir: string, src: string): boolean {
  if (/^(https?:|\/|[a-zA-Z]:)/.test(src)) return true; // remote / absolute
  return existsSync(resolve(projectDir, src));
}
