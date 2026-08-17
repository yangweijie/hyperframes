/**
 * Build the ffmpeg filtergraph that composites background + layers.
 *
 * Input layout (matches the args built by `buildCompositeArgs`):
 *   input 0              → background (video or image)
 *   input 1..N           → layer assets, in `composition.layers` order
 *
 * Each layer becomes one `overlay` node chained onto the accumulated canvas.
 * Layers are composited back-to-front. `enable='between(t,START,END)'` gates a
 * layer's visibility window; `loop` replays short loop assets to fill longer
 * windows. Transparent assets enter as `yuva420p` and `overlay` uses
 * `format=yuva420` so alpha is carried through the whole chain.
 */

import type { LayerComposition } from "./types.js";
import type { CompositeCodec } from "./codec.js";

/**
 * Build a `filter_complex` graph string.
 *
 * @param _assetPaths Resolved media paths for each layer. Kept for the
 *   public-call-site contract — `buildCompositeArgs` wires them into
 *   `-i` inputs in the same order; the filtergraph references them by
 *   positional index (`1:v`, `2:v`, ...), so this parameter is unused
 *   inside the graph builder but kept to keep the two helpers' signatures
 *   symmetric for callers.
 */
export function buildFilterComplex(composition: LayerComposition, _assetPaths: string[]): string {
  const { background } = composition;
  const parts: string[] = [];

  // Scale the background to the target composition size. The background may
  // be authored at a different resolution than the composition (e.g. a 720×1280
  // a-roll video inside a 1080×1920 composition), so normalize it first.
  parts.push(`[0:v]scale=${background.width}:${background.height}:flags=lanczos[bgscaled]`);
  let canvas = "bgscaled";

  composition.layers.forEach((layer, index) => {
    const src = `${index + 1}:v`;
    const scaled = `s${index}`;
    const looped = `lp${index}`;
    const out = `o${index}`;

    // Scale layer to background size, preserving alpha (yuva420p).
    parts.push(
      `[${src}]format=yuva420p,scale=${background.width}:${background.height}:flags=lanczos[${scaled}]`,
    );

    // Loop short assets to fill their visibility window.
    let chain: string = `[${scaled}]`;
    if (layer.kind === "loop") {
      // `size` defaults to the full input length — omit it so the whole asset
      // loops, rather than freezing on the first frame (`size=1`).
      parts.push(`${chain}loop=loop=-1[${looped}]`);
      chain = `[${looped}]`;
    }

    const enable = `between(t,${layer.start},${layer.start + layer.duration})`;
    const blend = layer.blend && layer.blend !== "normal" ? `blend=${layer.blend}` : null;
    const overlayArgs = [
      `x=${layer.x ?? 0}`,
      `y=${layer.y ?? 0}`,
      `enable='${enable}'`,
      // `auto` lets the overlay filter pick a format that preserves the
      // foreground alpha (it internally uses yuva420p when the overlay carries
      // alpha). An explicit `yuva420p` is rejected by overlay's `format` enum,
      // while `yuv420` would silently drop the alpha → opaque garbage.
      "format=auto",
      blend,
    ]
      .filter(Boolean)
      .join(":");

    // overlay order: `overlay[bg][fg]overlay_args` — first input is the
    // underlying layer (currently `canvas`), second input is the new top
    // layer (currently `chain`). DO NOT swap these, or the foreground will
    // be overwritten by the background instead of the reverse.
    parts.push(`[${canvas}]${chain}overlay=${overlayArgs}[${out}]`);
    canvas = out;
  });

  // Map the final canvas to the video stream.
  parts.push(`[${canvas}]null[outv]`);
  return parts.join(";");
}

/**
 * Build the full ffmpeg argument list for the composite stage.
 * Pass the result to `runFfmpeg` from `@hyperframes/engine`.
 *
 * `codec` is either a resolved `CompositeCodec` (from `resolveCompositeCodec`,
 * with hardware encoder + audio-copy decisions baked in) or a bare software
 * codec name for the simple case.
 */
export function buildCompositeArgs(
  composition: LayerComposition,
  assetPaths: string[],
  outputPath: string,
  codec: CompositeCodec | "libvpx-vp9" | "libx264" = "libvpx-vp9",
): string[] {
  const resolved: CompositeCodec =
    typeof codec === "string"
      ? {
          videoEncoder: codec,
          audioCopy: false,
          gpuEncoder: null,
        }
      : codec;

  const args: string[] = ["-hide_banner", "-loglevel", "error", "-y"];

  // Background input.
  args.push("-i", composition.background.mediaPath);
  // Layer asset inputs.
  for (const path of assetPaths) {
    args.push("-i", path);
  }

  const filterComplex = buildFilterComplex(composition, assetPaths);
  args.push("-filter_complex", filterComplex);
  args.push("-map", "[outv]");

  // Carry the background's first audio track through (gap #4: the main layer
  // is rendered with audio by the producer; overlay only touches video, so
  // the audio must be mapped explicitly or it is dropped). `0:a:0?` maps only
  // the first track, matching the single-track `audioCopy` decision in
  // `resolveCompositeCodec` — multi-track backgrounds don't leak extra tracks.
  if (composition.background.carryAudio !== false) {
    args.push("-map", "0:a:0?");
  }

  const isVp9 = resolved.videoEncoder === "libvpx-vp9";
  args.push("-c:v", resolved.videoEncoder);

  if (isVp9) {
    // VP9 WebM — alpha-capable, matches Hyperframes' webm output convention.
    args.push("-pix_fmt", "yuva420p", "-auto-alt-ref", "0");
  } else if (resolved.gpuEncoder === "amf") {
    // AMF H.264 — constant-QP quality control.
    args.push("-pix_fmt", "yuv420p", "-rc", "cqp", "-qp_i", "18", "-qp_p", "18");
  } else if (resolved.gpuEncoder === "nvenc") {
    args.push("-pix_fmt", "yuv420p", "-preset", "p4");
  } else if (resolved.gpuEncoder === "qsv") {
    args.push("-pix_fmt", "yuv420p", "-preset", "fast");
  } else if (resolved.gpuEncoder === "videotoolbox") {
    // videotoolbox requires `-allow_sw 1` for non-standard dimensions.
    args.push("-pix_fmt", "yuv420p", "-allow_sw", "1");
  } else if (resolved.gpuEncoder === "vaapi") {
    // vaapi needs `hwupload` + a vaapi frames context (not expressible here
    // without a device); fall back to software to avoid a hard failure.
    args.push("-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "18");
  } else {
    // Software libx264.
    args.push("-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "18");
  }

  // Audio: copy a single AAC track verbatim, else transcode.
  if (composition.background.carryAudio !== false) {
    if (resolved.audioCopy) {
      args.push("-c:a", "copy");
    } else if (isVp9) {
      args.push("-c:a", "libopus", "-b:a", "128k");
    } else {
      args.push("-c:a", "aac", "-b:a", "192k");
    }
  }

  args.push("-t", String(composition.background.duration));
  args.push(outputPath);
  return args;
}
