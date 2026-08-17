import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { ArgsDef, CommandDef } from "citty";
import { renderCompositionFromHtml } from "@hyperframes/ffmpeg-layer-renderer";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";

/**
 * Resolve a system-installed Chromium-family browser (Microsoft Edge or
 * Google Chrome) so the layer renderer can fall back to it when the
 * Hyperframes-managed chrome-headless-shell is missing or corrupted.
 */
function findSystemChromium(): string | undefined {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((p) => existsSync(p));
}

const args = {
  input: {
    type: "positional",
    description: "Input HTML composition (path or URL)",
    required: true,
  },
  output: {
    type: "string",
    description: "Output video path (default: ./out.mp4)",
    default: "./out.mp4",
    alias: "o",
  },
  fps: {
    type: "string",
    description: "Frames per second (default: 30)",
    default: "30",
    alias: "f",
  },
  workdir: {
    type: "string",
    description: "Working directory for intermediate assets",
    default: ".hyperframes-layer-render",
  },
  "no-progress": {
    type: "boolean",
    description: "Disable progress output",
    default: false,
  },
} satisfies ArgsDef;

const layerRenderCommand = {
  meta: {
    name: "layer-render",
    description:
      "FFmpeg-accelerated layered render — a static background layer plus pre-rendered transparent sub-composition layers composited by ffmpeg.",
  },
  args,
  async run({ args: parsed }: { args: Record<string, unknown> }) {
    const input = parsed.input as string;
    const output = parsed.output as string;
    const fps = Number(parsed.fps);
    const workDir = parsed.workdir as string;
    const showProgress = !parsed["no-progress"];

    if (!Number.isFinite(fps) || fps <= 0) {
      throw new Error(`Invalid --fps value: ${parsed.fps}`);
    }

    const projectDir = resolve(dirname(resolve(input)));
    const htmlPath = resolve(input);

    // @hyperframes/producer's runtime loader resolves hyperframe.manifest.json
    // via paths relative to the producer module; when producer is loaded
    // transitively through @hyperframes/ffmpeg-layer-renderer (and bundled
    // into cli.js) that resolution lands on a wrong directory. Pin it to a
    // known-good location so the layer render can start.
    if (!process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH) {
      const manifestCandidates = [
        resolve(__dirname, "../../producer/dist/hyperframe.manifest.json"),
        resolve(__dirname, "../../core/dist/hyperframe.manifest.json"),
      ];
      const found = manifestCandidates.find((p) => existsSync(p));
      if (found) process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = found;
    }
    if (!process.env.PRODUCER_HEADLESS_SHELL_PATH) {
      const systemChromium = findSystemChromium();
      if (systemChromium) {
        process.env.PRODUCER_HEADLESS_SHELL_PATH = systemChromium;
      }
    }

    let result;
    try {
      result = await renderCompositionFromHtml(htmlPath, {
        projectDir,
        workDir: resolve(workDir),
        outputPath: resolve(output),
        fps,
        log: (msg) => {
          if (showProgress) process.stdout.write(`${c.dim(msg)}\n`);
        },
        onProgress: showProgress
          ? (update) => {
              const pct = Math.round(update.progress * 100);
              const phase = update.stage ?? "";
              process.stdout.write(`\r${c.dim(phase)} ${c.cyan(`${pct}%`)}`);
            }
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorBox("Layer render failed", message);
      throw error;
    }

    if (showProgress) process.stdout.write("\n");

    const subLayers = result.layers.filter((l) => l.role !== "background");
    console.log("");
    console.log(c.bold("FFmpeg layer render report"));
    console.log(`  ${c.dim("output path")} : ${result.outputPath}`);
    console.log(`  ${c.dim("scale mode")}  : ${result.scaleMode}`);
    console.log(
      `  ${c.dim("layers cut")}  : ${result.layers.length} (1 background + ${subLayers.length} transparent overlay)`,
    );
    console.log("");
    console.log(c.bold("Layers:"));
    for (const layer of result.layers) {
      const tag = layer.role === "background" ? c.success("background") : c.cyan(layer.role);
      const src = layer.source || "(composition root)";
      console.log(`  - [${tag}] ${layer.id}: ${c.dim(src)}`);
    }
    console.log("");
    console.log(`  ${c.dim("prerender total")} : ${c.cyan(`${result.prerenderMs}ms`)}`);
    console.log(`  ${c.dim("composite")}       : ${c.cyan(`${result.compositeMs}ms`)}`);
    console.log(
      `  ${c.dim("grand total")}     : ${c.cyan(`${result.prerenderMs + result.compositeMs}ms`)}`,
    );
  },
} satisfies CommandDef<{ args: typeof args }>;

export default layerRenderCommand;
