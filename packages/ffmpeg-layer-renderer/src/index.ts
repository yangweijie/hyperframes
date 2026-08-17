/**
 * @hyperframes/ffmpeg-layer-renderer
 *
 * Layer-based FFmpeg compositing renderer for Hyperframes.
 *
 * Instead of per-frame full-page Chromium capture, split a composition into
 * independent layers, pre-render each dynamic layer once as a transparent
 * asset (ProRes 4444 MOV by default), then composite them with ffmpeg `overlay`.
 *
 * Validated in plans/spike: ~63 dB PSNR parity vs full-page render, with the
 * composite stage ~6× faster than frame capture. The acceleration comes from
 * reuse — reusable backgrounds, looping segments, and multi-layer composites
 * — not from making a single layer cheaper to capture.
 */

export {
  buildCompositeArgs,
  buildFilterComplex,
} from "./compose.js";
export {
  resolveCompositeCodec,
  type CompositeCodec,
  type ResolveCompositeCodecOptions,
} from "./codec.js";
export {
  DEFAULT_PSNR_THRESHOLD,
  measurePsnr,
  type ParityOptions,
  type ParityResult,
} from "./parity.js";
export {
  layerAssetExists,
  normalizeBlend,
  parseLayerSpecs,
  type ParseLayerSpecsOptions,
  type ParseLayerSpecsResult,
} from "./parse.js";
export {
  prerenderLayer,
  type PrerenderOptions,
} from "./prerender.js";
export {
  renderCompositionFromHtml,
  renderLayerComposition,
  type RenderCompositionFromHtmlOptions,
  type RenderLayerCompositionOptions,
} from "./render.js";
export {
  buildMainLayerHtml,
  needsMainLayerRender,
} from "./mainLayer.js";
export {
  materializeStandalone,
  templateToStandalone,
  type TemplateToStandaloneOptions,
} from "./standalone.js";
export {
  substituteVariables,
  type VariableMap,
} from "./variables.js";
export type {
  BackgroundSpec,
  LayerComposition,
  LayerKind,
  LayerRenderResult,
  LayerSpec,
  OverlayBlendMode,
  PrerenderResult,
  RenderProgressCallback,
  RenderProgressUpdate,
} from "./types.js";
