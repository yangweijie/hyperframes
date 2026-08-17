/**
 * End-to-end verify against the REAL registry vignelli composition
 * (curtain transitions + moving a-roll + audio + templating placeholders).
 *
 * Exercises all four previously-missing capabilities:
 *   1. templating placeholders (__VIDEO_SRC__ / __VIDEO_DURATION__)
 *   2. main-timeline non-subcomp layers (curtains)
 *   3. moving a-roll (opacity animation on the background)
 *   4. audio track
 */

import { resolve } from "node:path";
import { renderCompositionFromHtml } from "../src/index.js";

const projectDir = resolve(process.cwd(), "plans/spike/vignelli-real");

async function main() {
  const result = await renderCompositionFromHtml(
    resolve(projectDir, "index.html"),
    {
      projectDir,
      workDir: resolve(projectDir, "work"),
      outputPath: resolve(projectDir, "layered.mp4"),
      fps: 15,
      variables: {
        __VIDEO_SRC__: "a-roll.mp4",
        __VIDEO_DURATION__: "10.263",
      },
      log: console.log,
    },
  );

  console.log("render result:", JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("verify failed:", error);
  process.exit(1);
});
