/**
 * Unit tests for parseLayerSpecs — the automatic layer extraction that turns a
 * Hyperframes host composition (data-composition-src) into a LayerComposition.
 */

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeBlend, parseLayerSpecs } from "./parse.js";

// Platform-agnostic project dir (resolve normalizes to the current OS).
const projectDir = resolve("/tmp/project");

function hostHtml(layers: string[], backgroundMedia = ""): string {
  return `<!doctype html>
<html>
<head></head>
<body>
<div data-composition-id="main" data-width="1080" data-height="1920" data-duration="10.24">
  ${backgroundMedia ? `<video src="${backgroundMedia}" data-start="0" data-duration="10.24"></video>` : ""}
  ${layers.join("\n  ")}
</div>
</body>
</html>`;
}

function srcLayer({
  id = "overlays",
  src = "compositions/overlays.html",
  start = "0",
  duration = "10.24",
  track = "2",
}: {
  id?: string;
  src?: string;
  start?: string;
  duration?: string;
  track?: string;
} = {}): string {
  return `<div data-composition-id="${id}" data-composition-src="${src}" data-start="${start}" data-duration="${duration}" data-track-index="${track}"></div>`;
}

describe("parseLayerSpecs", () => {
  it("extracts sub-composition hosts as dynamic layers", () => {
    const html = hostHtml([srcLayer(), srcLayer({ id: "captions", src: "compositions/captions.html", track: "3" })]);
    const { composition } = parseLayerSpecs(html, { projectDir, fps: 30 });

    expect(composition.layers).toHaveLength(2);
    expect(composition.layers[0]).toMatchObject({
      id: "overlays",
      htmlPath: "compositions/overlays.html",
      start: 0,
      duration: 10.24,
      kind: "dynamic",
    });
    expect(composition.layers[1]).toMatchObject({
      id: "captions",
      htmlPath: "compositions/captions.html",
    });
  });

  it("orders layers by data-track-index ascending", () => {
    // captions has track 3, overlays has track 2 — overlays should come first.
    const html = hostHtml([
      srcLayer({ id: "captions", track: "3" }),
      srcLayer({ id: "overlays", track: "2" }),
    ]);
    const { composition } = parseLayerSpecs(html, { projectDir, fps: 30 });
    expect(composition.layers.map((l) => l.id)).toEqual(["overlays", "captions"]);
  });

  it("derives background from a media element that is not a sub-composition", () => {
    const html = hostHtml(
      [srcLayer()],
      "https://cdn.example.com/a-roll.mp4",
    );
    const { composition } = parseLayerSpecs(html, { projectDir, fps: 30 });
    expect(composition.background.mediaPath).toBe(
      "https://cdn.example.com/a-roll.mp4",
    );
  });

  it("reads width/height/duration from the composition root", () => {
    const html = hostHtml([srcLayer()]);
    const { composition } = parseLayerSpecs(html, { projectDir, fps: 30 });
    expect(composition.background.width).toBe(1080);
    expect(composition.background.height).toBe(1920);
    expect(composition.background.duration).toBe(10.24);
  });

  it("resolves relative background media paths against projectDir", () => {
    const html = hostHtml([srcLayer()], "media/a-roll.mp4");
    const { composition } = parseLayerSpecs(html, { projectDir, fps: 30 });
    expect(composition.background.mediaPath).toBe(
      resolve(projectDir, "media/a-roll.mp4"),
    );
  });

  it("skips hosts with empty data-composition-src", () => {
    const html = hostHtml([
      `<div data-composition-id="empty" data-composition-src=""></div>`,
      srcLayer(),
    ]);
    const result = parseLayerSpecs(html, { projectDir, fps: 30 });
    expect(result.composition.layers).toHaveLength(1);
    expect(result.skipped).toEqual([{ src: "", reason: "empty data-composition-src" }]);
  });

  it("uses host id as fallback layer id when composition-id is missing", () => {
    const html = `<div id="my-layer" data-composition-src="x.html" data-start="0" data-duration="1"></div>`;
    const { composition } = parseLayerSpecs(html, { projectDir, fps: 30 });
    expect(composition.layers[0]?.id).toBe("my-layer");
  });

  it("normalizes blend attribute", () => {
    expect(normalizeBlend("screen")).toBe("screen");
    expect(normalizeBlend("SCREEN")).toBe("screen");
    expect(normalizeBlend("normal")).toBeUndefined();
    expect(normalizeBlend(null)).toBeUndefined();
    expect(normalizeBlend("bogus")).toBeUndefined();
  });

  it("maps data-blend onto the layer spec", () => {
    const html = `<div data-composition-id="a" data-composition-src="a.html" data-start="0" data-duration="1" data-blend="screen"></div>`;
    const { composition } = parseLayerSpecs(html, { projectDir, fps: 30 });
    expect(composition.layers[0]?.blend).toBe("screen");
  });
});
