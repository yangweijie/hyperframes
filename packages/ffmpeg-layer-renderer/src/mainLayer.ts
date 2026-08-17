/**
 * Build a "main layer" HTML — the host composition with its sub-composition
 * hosts removed, so the remaining main-timeline content (a-roll video, curtain
 * transitions, grid, audio) can be rendered by the producer into a single
 * opaque background video.
 *
 * Rationale: the main composition is NOT a bare media file — its main timeline
 * drives elements like `#curtain-black` / `#a-roll-wrapper` that a bare
 * `mediaPath` background cannot express. Rendering the host-minus-subcomps as
 * one opaque video absorbs those (gaps #2 and #3) and carries the audio track
 * (gap #4), so the layer compositor only has to overlay the sub-compositions.
 */

import { parseHTML } from "linkedom";

const SUBCOMP_HOST_SELECTOR = "[data-composition-src]";

/**
 * Remove sub-composition hosts from a host HTML and return the remaining
 * document serialized. The main timeline script is preserved verbatim; hosts
 * that the script references would break, but that is out of scope for the
 * common "sub-compositions are independent layers" layout.
 */
export function buildMainLayerHtml(html: string): string {
  const { document } = parseHTML(html);

  for (const host of Array.from(
    document.querySelectorAll<Element>(SUBCOMP_HOST_SELECTOR),
  )) {
    host.remove();
  }

  return document.toString();
}

/**
 * Whether a host composition has main-timeline content beyond bare media and
 * sub-composition hosts — i.e. whether it needs a rendered main layer rather
 * than a bare media background.
 *
 * Heuristic: the main composition root has child elements that are neither
 * sub-composition hosts nor bare media (`video`/`audio`/`img`). Curtain
 * transitions, grid decorations, and other main-timeline-driven elements all
 * fall into this bucket, so rendering the host-minus-subcomps captures them.
 * A bare "video + subcomps" layout has no such children → false.
 */
export function needsMainLayerRender(html: string): boolean {
  const { document } = parseHTML(html);

  const root = document.querySelector("[data-composition-id]");
  if (!root) return false;

  for (const child of Array.from(root.children)) {
    if (child.closest(SUBCOMP_HOST_SELECTOR)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === "video" || tag === "audio" || tag === "img") continue;
    // A non-media, non-subcomp child means there's main-timeline content.
    return true;
  }

  return false;
}
