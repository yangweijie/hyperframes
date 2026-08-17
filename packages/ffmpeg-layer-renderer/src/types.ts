/**
 * Layer-based FFmpeg compositing renderer — public types.
 *
 * The core idea (validated in plans/spike): instead of per-frame full-page
 * Chromium capture, split a composition into independent layers, pre-render
 * each *dynamic* layer once as a transparent asset (ProRes 4444 MOV by
 * default), then composite them with ffmpeg `overlay`. Static layers are
 * captured once; looping segments are replayed via ffmpeg `loop`. This
 * removes the per-frame browser round-trip from the hot path.
 */

/** A single composited layer in a composition. */
export interface LayerSpec {
  /** Unique layer id within the composition. */
  id: string;
  /**
   * Path to the layer's HTML entry (self-contained DOM subtree + CSS +
   * seekable GSAP timeline), relative to the composition directory.
   * Required for `dynamic` and `static` layers; omitted for `background`.
   */
  htmlPath?: string;
  /** Time range, in seconds, over which this layer is visible. */
  start: number;
  duration: number;
  /** How the layer should be produced. */
  kind: LayerKind;
  /** Compositing position. Defaults to `(0, 0)` (top-left). */
  x?: number;
  y?: number;
  /**
   * When `kind === "loop"`, the number of times the layer's animation
   * repeats within `[start, start+duration)`. `-1` means loop indefinitely
   * to fill the window (ffmpeg `loop=loop=-1`).
   */
  repeat?: number;
  /** Compositing blend mode (ffmpeg overlay `blend`). */
  blend?: OverlayBlendMode;
}

export type LayerKind =
  /** Pre-render the layer's HTML once as a transparent asset (ProRes 4444 MOV by default). */
  | "dynamic"
  /**
   * Same as dynamic, but the layer's animation is a short loop that is
   * replayed to fill the visibility window (ffmpeg `loop`), avoiding a
   * full-duration pre-render.
   */
  | "loop"
  /** A static layer: captured as a single frame (PNG). */
  | "static"
  /**
   * A background layer that can be reused across compositions. Passed as a
   * pre-rendered media path directly (no HTML to capture).
   */
  | "background";

export type OverlayBlendMode = "normal" | "screen" | "multiply" | "overlay" | "add";

export interface BackgroundSpec {
  /** Media path (video or image) used as the base layer. */
  mediaPath: string;
  /**
   * When set, the background is a full HTML composition (not a bare media
   * file) — the host minus its sub-compositions. It carries the main-timeline
   * animation (curtain transitions, a-roll opacity, …) and audio, so it must
   * be rendered by the producer into an opaque video before compositing.
   * Relative to the project directory.
   */
  htmlPath?: string;
  /** Output width / height in pixels. */
  width: number;
  height: number;
  /** Frames per second of the output. */
  fps: number;
  /** Total composition duration in seconds. */
  duration: number;
  /**
   * Whether to carry the background's audio track into the final composite.
   * Defaults to true. Set to false for silent backgrounds.
   */
  carryAudio?: boolean;
}

/** A fully-specified layer composition ready to composite. */
export interface LayerComposition {
  background: BackgroundSpec;
  layers: LayerSpec[];
}

/** Result of pre-rendering one dynamic layer. */
export interface PrerenderResult {
  layerId: string;
  /** Path to the transparent asset (ProRes 4444 MOV by default). */
  assetPath: string;
  /** Asset duration in seconds (before looping). */
  assetDuration: number;
}

/** Output of the full layer render pipeline. */
export interface LayerRenderResult {
  outputPath: string;
  /** Wall-clock milliseconds for the composite stage. */
  compositeMs: number;
  /** Wall-clock milliseconds for all pre-render stages combined. */
  prerenderMs: number;
  /**
   * Per-layer summary for reporting. The first entry is the background
   * (referenced by `composition.background`), followed by one entry per
   * pre-rendered sub-composition layer. `role` distinguishes the opaque
   * background from the transparent overlay layers.
   */
  layers: LayerSummary[];
  /** Scale mode applied to the transparent layers. */
  scaleMode: "fit" | "fill" | "stretch";
}

/** One-line description of a single layer, for reporting/observability. */
export interface LayerSummary {
  /** "background" for the opaque base, or the layer `kind` for overlays. */
  role: string;
  /** Source path (background media/html, or sub-composition html). */
  source: string;
  /** Layer id (matches `LayerSpec.id`). */
  id: string;
}

/** A single progress update emitted during rendering. */
export interface RenderProgressUpdate {
  /** Overall progress 0–100. */
  progress: number;
  /** Human-readable current stage (e.g. "prerender:overlays", "composite"). */
  stage: string;
}

/** Progress callback shape shared by the layer renderers. */
export type RenderProgressCallback = (update: RenderProgressUpdate) => void;
