import { describe, expect, it } from "vitest";
import { buildMainLayerHtml, needsMainLayerRender } from "./mainLayer.js";

const VIGNELLI_LIKE = `<!doctype html>
<html><body>
<div id="main" data-composition-id="main-comp" data-width="1080" data-height="1920" data-duration="10.24">
  <div id="curtain-black" class="curtain"></div>
  <div id="curtain-red" class="curtain red"></div>
  <div data-composition-id="overlays" data-composition-src="compositions/overlays.html" data-start="0" data-duration="10.24" data-track-index="2"></div>
  <div data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="10.24" data-track-index="3"></div>
  <script>const tl = gsap.timeline({paused:true}); window.__timelines={};</script>
</div>
<div id="a-roll-wrapper"><video id="a-roll" src="a-roll.mp4" data-start="0" data-duration="10.24" data-track-index="0"></video></div>
<audio id="a-roll-audio" src="a-roll.mp4" data-start="0" data-duration="10.24" data-track-index="5"></audio>
</body></html>`;

describe("buildMainLayerHtml", () => {
  it("removes sub-composition hosts but keeps main-timeline content", () => {
    const out = buildMainLayerHtml(VIGNELLI_LIKE);
    expect(out).not.toContain("data-composition-src");
    expect(out).toContain("curtain-black");
    expect(out).toContain("curtain-red");
    expect(out).toContain('id="a-roll"');
    expect(out).toContain("a-roll-audio");
    expect(out).toContain("gsap.timeline");
  });
});

describe("needsMainLayerRender", () => {
  it("detects non-media tracked elements (curtains)", () => {
    expect(needsMainLayerRender(VIGNELLI_LIKE)).toBe(true);
  });

  it("returns false for a bare media + subcomps composition", () => {
    const bare = `<!doctype html><html><body>
<div data-composition-id="main" data-width="1080" data-height="1920" data-duration="10.24">
  <div data-composition-id="captions" data-composition-src="captions.html" data-track-index="3"></div>
</div>
<div id="a-roll-wrapper"><video id="a-roll" src="a-roll.mp4" data-track-index="0"></video></div>
</body></html>`;
    // The curtains have no data-track-index in this fixture, and video/audio
    // are media — so no non-media tracked element → false.
    expect(needsMainLayerRender(bare)).toBe(false);
  });
});
