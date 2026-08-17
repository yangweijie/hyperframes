/**
 * Progress-callback tests for renderLayerComposition. The render itself is
 * mocked (no ffmpeg / Chromium), so we only assert the progress sequence is
 * monotonic and terminates at 100.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@hyperframes/engine", () => ({
  runFfmpeg: vi.fn(),
  detectGpuEncoder: vi.fn(),
  extractAudioMetadata: vi.fn(),
}));

vi.mock("./prerender.js", () => ({
  prerenderLayer: vi.fn(),
  renderMainLayer: vi.fn(),
}));

import { runFfmpeg, detectGpuEncoder, extractAudioMetadata } from "@hyperframes/engine";
import { prerenderLayer } from "./prerender.js";
import { renderLayerComposition } from "./render.js";
import type { LayerComposition } from "./types.js";

const runMock = vi.mocked(runFfmpeg);
const prerenderMock = vi.mocked(prerenderLayer);
const detectMock = vi.mocked(detectGpuEncoder);
const extractMock = vi.mocked(extractAudioMetadata);

const bg = {
  mediaPath: "/tmp/bg.mp4",
  width: 1080,
  height: 1920,
  fps: 15,
  duration: 5,
};

function comp(layerCount: number): LayerComposition {
  return {
    background: bg,
    layers: Array.from({ length: layerCount }, (_, i) => ({
      id: `layer-${i}`,
      htmlPath: `layer-${i}.html`,
      start: 0,
      duration: 5,
      kind: "dynamic" as const,
    })),
  };
}

describe("renderLayerComposition progress", () => {
  it("emits monotonic progress ending at 100", async () => {
    detectMock.mockResolvedValue(null);
    extractMock.mockResolvedValue({ audioCodec: "aac" } as never);
    runMock.mockResolvedValue({ success: true, exitCode: 0, stdout: "", stderr: "" } as never);
    prerenderMock.mockImplementation(async (layer) => ({
      layerId: layer.id,
      assetPath: `/tmp/${layer.id}.mov`,
      assetDuration: 5,
    }));

    const updates: Array<{ progress: number; stage: string }> = [];
    await renderLayerComposition(comp(2), {
      projectDir: "/tmp",
      workDir: "/tmp/work",
      outputPath: "/tmp/out.mp4",
      fps: 15,
      onProgress: (u) => updates.push(u),
    });

    expect(updates.length).toBeGreaterThan(0);
    expect(updates.at(-1)?.progress).toBe(100);
    expect(updates.at(-1)?.stage).toBe("complete");

    // Monotonic non-decreasing.
    for (let i = 1; i < updates.length; i++) {
      expect(updates[i]!.progress).toBeGreaterThanOrEqual(updates[i - 1]!.progress);
    }

    // Includes a prerender stage for each layer and a composite stage.
    const stages = updates.map((u) => u.stage);
    expect(stages).toContain("prerender:layer-0");
    expect(stages).toContain("prerender:layer-1");
    expect(stages).toContain("composite");
  });
});
