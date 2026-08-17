/**
 * Parity gate: quantify fidelity of the layer-composited output vs a
 * full-page reference render, using ffmpeg's `psnr` filter.
 *
 * The spike (plans/spike/parity-report.md) measured ~63 dB PSNR for a
 * badge-pop layer composited over a shared background — far above the 40 dB
 * threshold Hyperframes' own regression harness uses. This module exposes
 * that check as a reusable gate.
 */

import { runFfmpeg } from "@hyperframes/engine";

export interface ParityResult {
  /** Mean PSNR across all compared frames, in dB. */
  meanPsnr: number;
  /** Minimum per-frame PSNR across all compared frames. */
  minPsnr: number;
  /** Whether the mean meets `threshold`. */
  passed: boolean;
}

export interface ParityOptions {
  threshold?: number;
}

/** Default fidelity threshold (matches Hyperframes regression harness). */
export const DEFAULT_PSNR_THRESHOLD = 40;

/**
 * Compare two same-dimension, same-fps videos frame-by-frame and return the
 * mean PSNR. Uses ffmpeg's `psnr` filter (YUV average) over the shorter of
 * the two inputs.
 */
export async function measurePsnr(
  referenceVideo: string,
  candidateVideo: string,
  options: ParityOptions = {},
): Promise<ParityResult> {
  const threshold = options.threshold ?? DEFAULT_PSNR_THRESHOLD;
  const args = [
    "-hide_banner",
    "-i",
    referenceVideo,
    "-i",
    candidateVideo,
    "-lavfi",
    "[0:v][1:v]psnr=shortest=1",
    "-f",
    "null",
    "-",
  ];

  const result = await runFfmpeg(args);
  if (!result.success) {
    throw new Error(`PSNR measurement failed (exit ${result.exitCode}): ${result.stderr}`);
  }

  // ffmpeg writes per-frame PSNR lines to stderr, ending with a summary:
  //   [Parsed_psnr_0 @ ...] PSNR y:.. u:.. v:.. average:.. min:.. max:..
  const summaryLine = result.stderr
    .split(/\r?\n/)
    .filter((line) => line.includes("average:"))
    .at(-1);

  const average = parseStat(summaryLine, "average");
  const min = parseStat(summaryLine, "min");
  if (average === null) {
    throw new Error(`Could not parse PSNR summary from ffmpeg output: ${summaryLine ?? result.stderr}`);
  }

  return {
    meanPsnr: average,
    minPsnr: min ?? average,
    passed: average >= threshold,
  };
}

function parseStat(line: string | undefined, key: string): number | null {
  if (!line) return null;
  const match = line.match(new RegExp(`${key}:(\\S+)`));
  if (!match || !match[1]) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}
