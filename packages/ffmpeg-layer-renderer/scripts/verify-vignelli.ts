/**
 * Verify parseLayerSpecs against the vignelli-stacking test composition.
 *
 * Step 1 (this script): parse the host HTML and print the extracted layer
 * composition — no browser, no render. Confirms the automatic layer splitting
 * produces the expected 3 layers (background video + overlays + captions).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLayerSpecs } from "../src/index.js";

const projectDir = resolve(
  process.cwd(),
  "packages/producer/tests/vignelli-stacking/src",
);

function main() {
  const html = readFileSync(resolve(projectDir, "index.html"), "utf-8");
  const result = parseLayerSpecs(html, { projectDir, fps: 30 });

  console.log("=== Parsed layer composition ===");
  console.log("background:", JSON.stringify(result.composition.background, null, 2));
  console.log("layers:", JSON.stringify(result.composition.layers, null, 2));
  console.log("skipped:", JSON.stringify(result.skipped, null, 2));

  // Assertions
  const ids = result.composition.layers.map((l) => l.id);
  const expectedIds = ["overlays", "captions"];
  const ok =
    ids.length === 2 &&
    ids[0] === expectedIds[0] &&
    ids[1] === expectedIds[1] &&
    result.composition.background.width === 1080 &&
    result.composition.background.height === 1920;

  console.log(ok ? "PASS" : "FAIL", "— expected layers:", expectedIds.join(", "), "got:", ids.join(", "));
  process.exit(ok ? 0 : 1);
}

main();
