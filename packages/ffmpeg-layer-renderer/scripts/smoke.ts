/**
 * Smoke test: render a badge-pop layer over a shared background via the
 * layer-compositing pipeline, then measure PSNR parity against a full-page
 * reference render.
 *
 * Run: bun packages/ffmpeg-layer-renderer/scripts/smoke.ts
 */

import { join, resolve } from "path";
import {
  measurePsnr,
  renderLayerComposition,
  type LayerComposition,
} from "../src/index.js";

const SPIKE = resolve(process.cwd(), "plans/spike");

async function main() {
  // Background is the already-rendered shared background (plans/spike/bg-only.webm).
  const background = {
    mediaPath: join(SPIKE, "bg-only.webm"),
    width: 1920,
    height: 1080,
    fps: 15,
    duration: 1,
  };

  const composition: LayerComposition = {
    background,
    layers: [
      {
        id: "badge-pop",
        htmlPath: "badge-pop-local.html",
        start: 0,
        duration: 1,
        kind: "dynamic",
        x: 0,
        y: 0,
      },
    ],
  };

  const result = await renderLayerComposition(composition, {
    projectDir: SPIKE,
    workDir: join(SPIKE, "work"),
    outputPath: join(SPIKE, "smoke-composite.webm"),
    fps: 15,
    log: console.log,
  });

  console.log("composite result:", JSON.stringify(result, null, 2));

  // Parity vs full-page reference (plans/spike/baseline-fullpage.webm).
  const parity = await measurePsnr(
    join(SPIKE, "baseline-fullpage.webm"),
    join(SPIKE, "smoke-composite.webm"),
  );
  console.log("parity result:", JSON.stringify(parity, null, 2));
}

main().catch((error) => {
  console.error("smoke failed:", error);
  process.exit(1);
});
