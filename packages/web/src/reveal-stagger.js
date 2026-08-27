/**
 * reveal-stagger.js — the authored stagger reaches the PAINT-TIME reveal lane
 * ([#585](https://github.com/Omega-JS-Stack/omega/issues/585), F5 of the
 * blind-verifier walk 2026-08-25).
 *
 * A band declares its rhythm ONCE, on the cluster:
 *
 *   <div class="omega-bento" data-omega-reveal-stagger="70">
 *
 * Two lanes have to honour that number. The motion engine reads the attribute
 * and writes `--omega-reveal-delay` per child (@omega.js/client modules/
 * motion.js) — but the engine is not there at first paint, which is the whole
 * reason the lead band animates from CSS. That CSS lane multiplies its
 * `:nth-child` index by `--omega-reveal-step`, and nothing set it: every lead
 * band staggered at the 90ms fallback while its author had written 40, 50, 60,
 * 70, 80 or 120 (62 authored attributes across 36 shipped section files).
 *
 * So the BUILD mirrors the attribute into the custom property on the same
 * element. The number keeps ONE home — the attribute an author types — and the
 * property, which inherits, reaches the reveal targets underneath it. A theme
 * or a consumer that sets `--omega-reveal-step` by hand wins: the mirror never
 * overwrites a value already there.
 *
 * A transform rather than markup, because the alternative is typing the number
 * twice in 62 places and watching the two drift.
 */

// The attribute, and the property it feeds.
const STAGGER_ATTR = /\bdata-omega-reveal-stagger="(\d+)"/g;
const STEP_PROPERTY = '--omega-reveal-step';

/**
 * The end of the tag that starts at `open`, respecting quoted attribute values
 * (a `>` inside a title attribute is not the end of the tag).
 * @param {string} html
 * @param {number} open - index of the `<`
 * @returns {number} index of the closing `>`, or -1
 */
function tagEnd(html, open) {
  let quote = null;
  for (let i = open + 1; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return i;
  }
  return -1;
}

/**
 * Mirror every `data-omega-reveal-stagger="N"` into `--omega-reveal-step: Nms`
 * on the same element. Idempotent, and a hand-authored step is left alone.
 * @param {string} html - a rendered page
 * @returns {string}
 */
function mirrorRevealStagger(html) {
  const edits = [];
  STAGGER_ATTR.lastIndex = 0;
  let match;
  while ((match = STAGGER_ATTR.exec(html)) !== null) {
    const open = html.lastIndexOf('<', match.index);
    const close = tagEnd(html, open);
    if (open === -1 || close === -1) continue;

    const tag = html.slice(open, close + 1);
    if (tag.includes(STEP_PROPERTY)) continue; // authored by hand, or already mirrored

    const declaration = `${STEP_PROPERTY}: ${match[1]}ms`;
    const style = tag.match(/\bstyle="([^"]*)"/);
    const mirrored = style
      ? tag.replace(style[0], `style="${declaration}; ${style[1]}"`)
      : `${tag.slice(0, match.index - open + match[0].length)} style="${declaration}"${tag.slice(match.index - open + match[0].length)}`;

    edits.push({ open, close, mirrored });
  }

  // Splice from the END so every earlier offset stays valid.
  let out = html;
  for (const edit of edits.reverse()) out = out.slice(0, edit.open) + edit.mirrored + out.slice(edit.close + 1);
  return out;
}

module.exports = { mirrorRevealStagger, STEP_PROPERTY };
