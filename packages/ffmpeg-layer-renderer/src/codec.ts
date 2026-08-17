/**
 * Resolve the video/audio codec for the final composite, reusing the engine's
 * GPU-encoder detection and audio metadata probes.
 *
 * - Video: prefer a hardware encoder when the machine exposes one
 *   (`detectGpuEncoder` → `h264_amf`/`h264_nvenc`/…), else fall back to
 *   `libx264` (or `libvpx-vp9` for WebM). This is the same detection the
 *   producer's encode stage uses, so the composite gets the same acceleration.
 * - Audio: copy the first audio track verbatim when it is AAC (`-c:a copy`,
 *   zero loss + zero re-encode) instead of transcoding, matching the
 *   producer's `shouldCopyAacSidecar` behaviour. The composite maps only the
 *   first track (`0:a:0?`), so `audioCopy` is decided against that same track.
 */

import { detectGpuEncoder, extractAudioMetadata } from "@hyperframes/engine";
import type { GpuEncoder } from "@hyperframes/engine";

/** Map a concrete GPU encoder to its H.264 ffmpeg encoder name. */
const H264_ENCODER_BY_GPU: Record<Exclude<GpuEncoder, null>, string> = {
  nvenc: "h264_nvenc",
  videotoolbox: "h264_videotoolbox",
  vaapi: "h264_vaapi",
  qsv: "h264_qsv",
  amf: "h264_amf",
};

export interface CompositeCodec {
  /** The ffmpeg video encoder name (e.g. `h264_amf`, `libx264`, `libvpx-vp9`). */
  videoEncoder: string;
  /** Whether the background's first audio track (AAC) can be copied verbatim. */
  audioCopy: boolean;
  /** The concrete GPU encoder in use, or null for software encoding. */
  gpuEncoder: GpuEncoder;
}

export interface ResolveCompositeCodecOptions {
  /**
   * Requested codec family. `libx264`/`libvpx-vp9` name the software fallback;
   * a hardware encoder of the matching family is preferred when available.
   */
  codec?: "libx264" | "libvpx-vp9";
  /** Background media path, probed for an audio track. */
  backgroundMediaPath?: string;
  /** Whether to carry audio at all (skip the probe when false). */
  carryAudio?: boolean;
}

/**
 * Resolve the composite codec: detect a usable hardware H.264 encoder, and
 * determine whether the background audio can be copied verbatim.
 */
export async function resolveCompositeCodec(
  options: ResolveCompositeCodecOptions = {},
): Promise<CompositeCodec> {
  const codec = options.codec ?? "libx264";
  const gpuEncoder = await detectGpuEncoder();

  let videoEncoder: string;
  if (codec === "libvpx-vp9") {
    // WebM output — no hardware VP9 path in scope; keep software VP9.
    videoEncoder = "libvpx-vp9";
  } else if (gpuEncoder) {
    videoEncoder = H264_ENCODER_BY_GPU[gpuEncoder];
  } else {
    videoEncoder = "libx264";
  }

  let audioCopy = false;
  if (options.carryAudio !== false && options.backgroundMediaPath) {
    try {
      const meta = await extractAudioMetadata(options.backgroundMediaPath);
      audioCopy = meta.audioCodec === "aac";
    } catch {
      // No audio stream (or unprobeable) — leave copy disabled; the `0:a?`
      // mapping is optional so absence is safe.
      audioCopy = false;
    }
  }

  return { videoEncoder, audioCopy, gpuEncoder };
}
