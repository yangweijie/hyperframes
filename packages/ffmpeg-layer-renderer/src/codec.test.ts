import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@hyperframes/engine", () => ({
  detectGpuEncoder: vi.fn(),
  extractAudioMetadata: vi.fn(),
}));

import { detectGpuEncoder, extractAudioMetadata } from "@hyperframes/engine";
import { resolveCompositeCodec } from "./codec.js";

const detectMock = vi.mocked(detectGpuEncoder);
const extractMock = vi.mocked(extractAudioMetadata);

describe("resolveCompositeCodec", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("falls back to libx264 when no GPU encoder is detected", async () => {
    detectMock.mockResolvedValue(null);
    const codec = await resolveCompositeCodec({ codec: "libx264" });
    expect(codec.videoEncoder).toBe("libx264");
    expect(codec.gpuEncoder).toBeNull();
  });

  it("maps amf → h264_amf", async () => {
    detectMock.mockResolvedValue("amf");
    const codec = await resolveCompositeCodec({ codec: "libx264" });
    expect(codec.videoEncoder).toBe("h264_amf");
    expect(codec.gpuEncoder).toBe("amf");
  });

  it("maps nvenc → h264_nvenc", async () => {
    detectMock.mockResolvedValue("nvenc");
    const codec = await resolveCompositeCodec({ codec: "libx264" });
    expect(codec.videoEncoder).toBe("h264_nvenc");
  });

  it("keeps libvpx-vp9 for webm regardless of GPU", async () => {
    detectMock.mockResolvedValue("amf");
    const codec = await resolveCompositeCodec({ codec: "libvpx-vp9" });
    expect(codec.videoEncoder).toBe("libvpx-vp9");
  });

  it("enables audio copy when background audio is aac", async () => {
    detectMock.mockResolvedValue(null);
    extractMock.mockResolvedValue({ audioCodec: "aac" } as never);
    const codec = await resolveCompositeCodec({
      codec: "libx264",
      backgroundMediaPath: "/tmp/bg.mp4",
    });
    expect(codec.audioCopy).toBe(true);
  });

  it("disables audio copy for non-aac background audio", async () => {
    detectMock.mockResolvedValue(null);
    extractMock.mockResolvedValue({ audioCodec: "mp3" } as never);
    const codec = await resolveCompositeCodec({
      codec: "libx264",
      backgroundMediaPath: "/tmp/bg.mp4",
    });
    expect(codec.audioCopy).toBe(false);
  });

  it("skips the audio probe when carryAudio is false", async () => {
    detectMock.mockResolvedValue(null);
    const codec = await resolveCompositeCodec({
      codec: "libx264",
      backgroundMediaPath: "/tmp/bg.mp4",
      carryAudio: false,
    });
    expect(extractMock).not.toHaveBeenCalled();
    expect(codec.audioCopy).toBe(false);
  });

  it("treats an unprobeable background as no-copy (safe)", async () => {
    detectMock.mockResolvedValue(null);
    extractMock.mockRejectedValue(new Error("no audio"));
    const codec = await resolveCompositeCodec({
      codec: "libx264",
      backgroundMediaPath: "/tmp/bg.mp4",
    });
    expect(codec.audioCopy).toBe(false);
  });
});
