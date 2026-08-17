// Cross-platform replacement for the `filesize` pre-commit hook.
// The original was a multi-line bash `for` loop that lefthook executes via
// `sh -c` on Windows, where it intermittently fails to parse (`$f: -c: line
// 7: syntax error`) and aborts the whole pre-commit with exit status 2 — even
// when no file actually exceeds the limit. Node is cross-platform, so this
// removes the shell-parsing footgun entirely.
//
// Scoped to packages/studio: the 600-LOC ceiling is a studio architecture
// standard (App.tsx decomposition work). Mirrors the lefthook glob/exclude.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_LINES = 600;
const STUDIO_GLOB = "packages/studio/**/*.{ts,tsx}";

function listStudioFiles() {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--", STUDIO_GLOB],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git diff exited with status ${result.status}`);
  }
  return result.stdout.split("\n").filter(Boolean);
}

function isExcluded(file) {
  return /\.test\.(ts|tsx)$|\.generated\./.test(file);
}

function main() {
  const oversized = [];
  for (const file of listStudioFiles()) {
    if (isExcluded(file)) continue;
    let count;
    try {
      count = readFileSync(file, "utf8").split("\n").length;
    } catch {
      continue; // unreadable (e.g. already deleted in index) — skip
    }
    if (count > MAX_LINES) {
      oversized.push({ file, count });
    }
  }
  if (oversized.length > 0) {
    for (const { file, count } of oversized) {
      console.error(`ERROR: ${file} has ${count} lines (max ${MAX_LINES})`);
    }
    process.exit(1);
  }
}

main();
