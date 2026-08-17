/**
 * Unit tests for buildFilterComplex — the pure function at the heart of the
 * composite stage. These guard the key invariants:
 *   - overlay order: [bg][fg], never [fg][bg] (badge-disappear bug)
 *   - format=yuva420p before any scale/overlay (alpha preservation)
 *   - enable='between(t,START,END)' uses layer.start and end
 *   - loop chain is inserted only for kind === "loop"
 *   - output [outv] is the final canvas
 */

import { describe, expect, it } from "vitest";
import { buildCompositeArgs, buildFilterComplex } from "./compose.js";
import type { LayerComposition, LayerSpec } from "./types.js";

const bg = {
  mediaPath: "/tmp/bg.webm",
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 5,
};

function layer(partial: Partial<LayerSpec> & { id: string }): LayerSpec {
  return {
    htmlPath: `${partial.id}.html`,
    start: 0,
    duration: 5,
    kind: "dynamic",
    x: 0,
    y: 0,
    ...partial,
  };
}

describe("buildFilterComplex", () => {
  it("composes a single dynamic layer with format=yuva420p and overlay format=yuva420", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" })],
    };
    const graph = buildFilterComplex(comp, ["/tmp/a.webm"]);

    expect(graph).toContain("[1:v]format=yuva420p");
    expect(graph).toContain("format=yuva420");
    // bg -> fg order (NOT reversed): bg is scaled to "[bgscaled]", fg is "[s0]"
    expect(graph).toMatch(/\[bgscaled\]\[s0\]overlay=/);
    expect(graph).not.toMatch(/\[s0\]\[bgscaled\]overlay=/);
    // final canvas mapped to outv
    expect(graph).toContain("[o0]null[outv]");
  });

  it("gates layer visibility with enable=between(t,START,END)", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a", start: 1.5, duration: 2.25 })],
    };
    const graph = buildFilterComplex(comp, ["/tmp/a.webm"]);

    expect(graph).toContain("enable='between(t,1.5,3.75)'");
  });

  it("inserts loop chain only for kind === 'loop'", () => {
    const dynamicComp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a", kind: "dynamic" })],
    };
    expect(buildFilterComplex(dynamicComp, ["/tmp/a.webm"])).not.toContain("loop=loop=-1");

    const loopComp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a", kind: "loop" })],
    };
    expect(buildFilterComplex(loopComp, ["/tmp/a.webm"])).toContain("loop=loop=-1");
    // `size` must NOT be pinned to 1 (that would freeze the loop on frame 0).
    expect(buildFilterComplex(loopComp, ["/tmp/a.webm"])).not.toContain("size=1");
  });

  it("chains multiple layers back-to-front with distinct labels", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" }), layer({ id: "b" }), layer({ id: "c" })],
    };
    const graph = buildFilterComplex(comp, ["/tmp/a.webm", "/tmp/b.webm", "/tmp/c.webm"]);

    // Each layer has a unique scaled/looped/out label.
    expect(graph).toMatch(/\[1:v\]format=yuva420p.*\[s0\]/);
    expect(graph).toMatch(/\[2:v\]format=yuva420p.*\[s1\]/);
    expect(graph).toMatch(/\[3:v\]format=yuva420p.*\[s2\]/);
    // Chaining: layer 2 overlays on top of [o0] (layer 1's output).
    expect(graph).toMatch(/\[o0\]\[s1\]overlay=/);
    expect(graph).toMatch(/\[o1\]\[s2\]overlay=/);
    // Final canvas goes to [outv].
    expect(graph).toContain("[o2]null[outv]");
  });

  it("emits blend= only when blend is set and not 'normal'", () => {
    const normal: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" })],
    };
    expect(buildFilterComplex(normal, ["/tmp/a.webm"])).not.toContain("blend=");

    const screen: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a", blend: "screen" })],
    };
    expect(buildFilterComplex(screen, ["/tmp/a.webm"])).toContain("blend=screen");
  });

  it("uses layer x/y for overlay positioning", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a", x: 100, y: 50 })],
    };
    const graph = buildFilterComplex(comp, ["/tmp/a.webm"]);
    expect(graph).toMatch(/x=100/);
    expect(graph).toMatch(/y=50/);
  });

  it("scales layer to background dimensions with alpha preserved", () => {
    const comp: LayerComposition = {
      background: { ...bg, width: 800, height: 600 },
      layers: [layer({ id: "a" })],
    };
    const graph = buildFilterComplex(comp, ["/tmp/a.webm"]);
    expect(graph).toContain("scale=800:600:flags=lanczos");
    // Layer chain: format=yuva420p must come BEFORE its scale filter (order
    // matters for alpha preservation). The background also scales, so assert
    // the layer's own chain is "format=yuva420p,scale=800:600".
    expect(graph).toContain("format=yuva420p,scale=800:600:flags=lanczos");
  });
});

describe("buildCompositeArgs", () => {
  it("emits background input first, then layer inputs in order", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" }), layer({ id: "b" })],
    };
    const args = buildCompositeArgs(comp, ["/tmp/a.webm", "/tmp/b.webm"], "/tmp/out.webm");
    expect(args).toContain("-i");
    expect(args[args.indexOf("-i") + 1]).toBe("/tmp/bg.webm");
    // Layer inputs follow.
    const inputPaths = args.filter((_, i) => args[i - 1] === "-i").slice(1);
    expect(inputPaths).toEqual(["/tmp/a.webm", "/tmp/b.webm"]);
  });

  it("selects libvpx-vp9 with yuva420p by default", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" })],
    };
    const args = buildCompositeArgs(comp, ["/tmp/a.webm"], "/tmp/out.webm");
    expect(args).toContain("libvpx-vp9");
    expect(args).toContain("yuva420p");
    expect(args).toContain("-auto-alt-ref");
  });

  it("selects libx264 with yuv420p when codec='libx264'", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" })],
    };
    const args = buildCompositeArgs(comp, ["/tmp/a.webm"], "/tmp/out.webm", "libx264");
    expect(args).toContain("libx264");
    expect(args).toContain("yuv420p");
  });

  it("places output path last and includes -t duration", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" })],
    };
    const args = buildCompositeArgs(comp, ["/tmp/a.webm"], "/tmp/out.webm");
    expect(args.at(-1)).toBe("/tmp/out.webm");
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("5");
  });

  it("carries background audio by default (gap #4)", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" })],
    };
    const args = buildCompositeArgs(comp, ["/tmp/a.webm"], "/tmp/out.webm", "libx264");
    expect(args).toContain("-map");
    expect(args).toContain("0:a:0?");
    expect(args).toContain("aac");
  });

  it("omits audio when background.carryAudio is false", () => {
    const comp: LayerComposition = {
      background: { ...bg, carryAudio: false },
      layers: [layer({ id: "a" })],
    };
    const args = buildCompositeArgs(comp, ["/tmp/a.webm"], "/tmp/out.webm", "libx264");
    expect(args).not.toContain("0:a:0?");
  });

  it("uses hardware h264_amf encoder with CQP when GPU codec is amf", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" })],
    };
    const args = buildCompositeArgs(comp, ["/tmp/a.webm"], "/tmp/out.webm", {
      videoEncoder: "h264_amf",
      audioCopy: false,
      gpuEncoder: "amf",
    });
    expect(args).toContain("h264_amf");
    expect(args).toContain("-rc");
    expect(args).toContain("cqp");
  });

  it("copies audio verbatim when audioCopy is true", () => {
    const comp: LayerComposition = {
      background: bg,
      layers: [layer({ id: "a" })],
    };
    const args = buildCompositeArgs(comp, ["/tmp/a.webm"], "/tmp/out.webm", {
      videoEncoder: "libx264",
      audioCopy: true,
      gpuEncoder: null,
    });
    expect(args).toContain("-c:a");
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
  });
});