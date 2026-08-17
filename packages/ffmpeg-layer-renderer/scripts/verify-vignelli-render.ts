/**
 * Full end-to-end verify for vignelli-stacking:
 *   1. parseLayerSpecs on the host index.html
 *   2. template→standalone for each sub-composition
 *   3. pre-render each sub-composition to a transparent WebM
 *   4. composite background video + transparent layers via ffmpeg overlay
 *   5. measure PSNR vs the full-page baseline render
 *
 * Run:
 *   PRODUCER_HEADLESS_SHELL_PATH=<chrome> bun \
 *     packages/ffmpeg-layer-renderer/scripts/verify-vignelli-render.ts
 */

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  materializeStandalone,
  measurePsnr,
  parseLayerSpecs,
  renderLayerComposition,
} from "../src/index.js";

const projectDir = resolve(process.cwd(), "plans/spike/vignelli");

async function main() {
  const hostHtml = readFileSync(resolve(projectDir, "index.html"), "utf-8");
  const { composition } = parseLayerSpecs(hostHtml, { projectDir, fps: 15 });

  console.log("parsed background:", composition.background.mediaPath);
  console.log("parsed layers:", composition.layers.map((l) => `${l.id}@${l.htmlPath}`));

  // Materialize each sub-composition into a standalone HTML next to gsap.min.js.
  const materialized: string[] = [];
  for (const layer of composition.layers) {
    const standalonePath = resolve(projectDir, `standalone-${layer.id}.html`);
    materializeStandalone({
      filePath: resolve(projectDir, layer.htmlPath!),
      gsapRelativePath: "gsap.min.js",
      outputPath: standalonePath,
    });
    // Point the layer at the standalone file (relative to projectDir).
    layer.htmlPath = `standalone-${layer.id}.html`;
    materialized.push(standalonePath);
    console.log(`materialized ${layer.id} → ${standalonePath}`);
  }

  const result = await renderLayerComposition(composition, {
    projectDir,
    workDir: resolve(projectDir, "work"),
    outputPath: resolve(projectDir, "layered.webm"),
    fps: 15,
    log: console.log,
  });
  console.log("render result:", JSON.stringify(result, null, 2));

  // Parity vs the full-page baseline.
  const parity = await measurePsnr(
    resolve(projectDir, "baseline-full.webm"),
    resolve(projectDir, "layered.webm"),
  );
  console.log("parity:", JSON.stringify(parity, null, 2));
}

main().catch((error) => {
  console.error("verify failed:", error);
  process.exit(1);
});
