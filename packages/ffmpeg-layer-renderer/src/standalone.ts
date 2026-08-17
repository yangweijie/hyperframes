/**
 * Convert a Hyperframes sub-composition file (a `<template>` wrapping a
 * self-contained `data-composition-id` root) into a standalone HTML document
 * that the producer can render directly as a single transparent layer.
 *
 * The producer's normal path inlines sub-compositions into the host and never
 * renders them alone. For layer compositing we need each sub-composition as an
 * independent renderable page, so this unwraps the `<template>` and re-wraps
 * its inner HTML in a minimal document with a local GSAP script.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { dirname } from "node:path";
import { substituteVariables, type VariableMap } from "./variables.js";

export interface TemplateToStandaloneOptions {
  /** Absolute path to the sub-composition file. */
  filePath: string;
  /** Path to a local gsap.min.js, relative to the output document. */
  gsapRelativePath: string;
  /**
   * Templating placeholders to substitute (e.g. `__VIDEO_DURATION__`) inside
   * the sub-composition before writing the standalone document.
   */
  variables?: VariableMap;
}

/**
 * Whether a sub-composition file uses the `<template>` wrapper (as opposed to
 * being an already-standalone HTML document with a root in `<body>`).
 */
export function hasTemplate(filePath: string): boolean {
  const raw = readFileSync(filePath, "utf-8");
  const { document } = parseHTML(raw);
  return document.querySelector("template") !== null;
}

/**
 * Read a sub-composition `<template>` file and produce a standalone HTML
 * document string. The `data-composition-id` root, its `<style>`, and its
 * `<script>` are preserved verbatim; only the `<template>` wrapper is removed.
 */
export function templateToStandalone(
  options: TemplateToStandaloneOptions,
): string {
  const raw = readFileSync(options.filePath, "utf-8");
  const { document } = parseHTML(raw);

  const template = document.querySelector("template");
  if (!template) {
    throw new Error(
      `Sub-composition has no <template> element: ${options.filePath}`,
    );
  }

  let inner = template.innerHTML;
  if (!inner.trim()) {
    throw new Error(`Sub-composition <template> is empty: ${options.filePath}`);
  }
  if (options.variables) {
    inner = substituteVariables(inner, options.variables);
  }

  // The inner HTML already carries its own <style> and <script>. Re-wrapping
  // in a minimal document is sufficient for the producer to render it as a
  // standalone composition (the timeline registers on window.__timelines).
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script src="${options.gsapRelativePath}"></script>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { width: 1080px; height: 1920px; overflow: hidden; background: transparent; }
    </style>
  </head>
  <body>
${inner}
  </body>
</html>
`;
}

/**
 * Materialize a sub-composition into a standalone HTML file on disk.
 * Returns the written file path.
 */
export function materializeStandalone(
  options: TemplateToStandaloneOptions & { outputPath: string },
): string {
  const html = templateToStandalone(options);
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, html, "utf-8");
  return options.outputPath;
}
