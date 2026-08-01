/**
 * Vert unit document — the ONE producer of vert unit documents.
 *
 * Every vert unit document in the stack comes from this function: the
 * backend's /omega/verts/serve route calls it for house inventory, and the
 * client's terminal promo lane calls it for the built-in omegajs.dev unit.
 * There is no second template anywhere.
 *
 * The document is self-contained (inline css/js, no external request), it
 * reports its rendered size to the host ('omega-vert:set-dimensions' on load
 * plus a ResizeObserver), it forwards clicks ('omega-vert:click'), and it
 * NEVER refreshes itself — the host owns the lifecycle (docs/web/ads-system.md).
 *
 * The look is one media row: thumbnail left, title with a clamped muted
 * description beside it, a hairline, then a muted label on the left and the
 * accent CTA button on the right. The document is content-sized: its natural
 * height IS the card height, and the host shrinks the frame to the reported
 * height (the slot preset is a ceiling, never a floor).
 *
 * Escaping posture: every text field is escaped. `imageMarkup` is the ONE
 * trusted-markup slot and takes framework constants only (the promo's inline
 * svg mark) — never anything from vert data.
 */

// Fixed postMessage vocabulary — the host and the document agree here
export const MESSAGE_DIMENSIONS = 'omega-vert:set-dimensions';
export const MESSAGE_CLICK = 'omega-vert:click';

// The one utm_medium every vert click carries, both lanes
export const UTM_MEDIUM = 'omega-vert';

// The promo lane's campaign (a served vert's campaign is its own id)
export const UTM_CAMPAIGN_PROMO = 'omega-promo';

// The default accent pair: neutral ink, the served-unit look
export const DEFAULT_ACCENT = {
  light: '#1a1a1a',
  lightText: '#ffffff',
  dark: '#eeeeee',
  darkText: '#1a1a1a',
};

// The omega indigo pair — the promo's accent
export const OMEGA_ACCENT = {
  light: '#4f46e5',
  lightText: '#ffffff',
  dark: '#8b85f5',
  darkText: '#16181d',
};

// A slot shorter than this (or narrower than the width below) tightens the
// row: smaller thumbnail, no description line
const COMPACT_HEIGHT_UNDER = 120;
const COMPACT_WIDTH_UNDER = 360;

/**
 * Escape a string for safe insertion into HTML text/attribute context.
 * @param {*} input - any value
 * @returns {string} escaped text
 */
export function escapeHtml(input) {
  return `${input === undefined || input === null ? '' : input}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Tag a click destination with the vert UTM set — the ONE place either lane
 * builds it (the promo's omegajs.dev link here in the client, a served vert's
 * stored link in the backend's redirect route, which imports this function).
 *
 * Existing params WIN: a key already on the URL is never overwritten, so an
 * advertiser's own tagging survives verbatim. A non-http(s) or unparseable
 * value comes back untouched.
 *
 * @param {string} url - the destination URL
 * @param {object} [params]
 * @param {string} [params.source] - utm_source (the host page's hostname)
 * @param {string} [params.medium] - utm_medium (UTM_MEDIUM)
 * @param {string} [params.campaign] - utm_campaign (vert id / UTM_CAMPAIGN_PROMO)
 * @param {string} [params.content] - utm_content (the slot's size preset)
 * @returns {string} the tagged URL
 */
export function applyVertUtm(url, params) {
  params = params || {};

  let target;

  try {
    target = new URL(url);
  } catch (e) {
    return `${url === undefined || url === null ? '' : url}`;
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return url;
  }

  const utm = {
    utm_source: params.source,
    utm_medium: params.medium,
    utm_campaign: params.campaign,
    utm_content: params.content,
  };

  for (const [key, value] of Object.entries(utm)) {
    // Never overwrite the advertiser's own tagging
    if (!value || target.searchParams.has(key)) {
      continue;
    }

    target.searchParams.set(key, value);
  }

  return target.toString();
}

/**
 * Parse a dimension hint to a positive integer, 0 when unusable.
 * @param {*} value
 * @returns {number}
 */
function toPx(value) {
  const num = parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/**
 * Render the vert unit document.
 * @param {object} options
 * @param {string} [options.id] - unit id echoed in every postMessage
 * @param {string} [options.href] - the click destination (redirect route / promo url)
 * @param {string} [options.title] - headline text
 * @param {string} [options.description] - one-line pitch under the headline
 * @param {string} [options.button] - CTA button label
 * @param {string} [options.label] - muted bottom-left label (default 'Sponsored')
 * @param {string} [options.imageUrl] - http(s) thumbnail source (escaped)
 * @param {string} [options.imageMarkup] - TRUSTED thumbnail markup (framework constants only)
 * @param {string} [options.theme] - 'light' | 'dark'; anything else follows the OS
 * @param {number|string} [options.width] - slot width hint in px
 * @param {number|string} [options.height] - slot height hint in px
 * @param {object} [options.accent] - { light, lightText, dark, darkText } accent pair
 * @param {string} [options.targetOrigin] - origin every postMessage targets ('*' when unknown)
 * @returns {string} a complete html document
 */
export function renderVertDocument(options) {
  options = options || {};

  const theme = options.theme === 'dark' || options.theme === 'light'
    ? options.theme
    : '';
  const width = toPx(options.width);
  const height = toPx(options.height);
  const accent = options.accent || DEFAULT_ACCENT;
  const targetOrigin = options.targetOrigin || '*';
  const id = options.id || '';

  // A short or narrow slot tightens the row instead of wrapping tall; a
  // skyscraper-shaped slot stacks the thumbnail above the copy. The compact
  // numbers below (32px thumb, 6px paddings and rule margins) are budgeted so
  // the whole card lands under the leaderboard ceiling — the shortest preset,
  // and the one a taller card would get cropped by.
  const compact = (height > 0 && height < COMPACT_HEIGHT_UNDER) || (width > 0 && width < COMPACT_WIDTH_UNDER);
  const stacked = width > 0 && height >= width * 2;
  const thumbPx = compact ? 32 : 56;

  const thumb = options.imageMarkup
    ? `<span class="omega-vert-thumb">${options.imageMarkup}</span>`
    : options.imageUrl
      ? `<span class="omega-vert-thumb"><img class="omega-vert-image" src="${escapeHtml(options.imageUrl)}" alt=""></span>`
      : '';
  const description = options.description && !compact
    ? `<span class="omega-vert-description">${escapeHtml(options.description)}</span>`
    : '';
  const button = options.button
    ? `<span class="omega-vert-button">${escapeHtml(options.button)}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ''}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Sponsored</title>
  <style>
    :root {
      color-scheme: light dark;
      --omega-vert-bg: #ffffff;
      --omega-vert-border: #e2e2e2;
      --omega-vert-text: #16181d;
      --omega-vert-muted: #5a6270;
      --omega-vert-accent: ${accent.light};
      --omega-vert-accent-text: ${accent.lightText};
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --omega-vert-bg: #16181d;
        --omega-vert-border: #333333;
        --omega-vert-text: #f2f4f8;
        --omega-vert-muted: #9aa3b2;
        --omega-vert-accent: ${accent.dark};
        --omega-vert-accent-text: ${accent.darkText};
      }
    }
    :root[data-theme="light"] {
      color-scheme: light;
      --omega-vert-bg: #ffffff;
      --omega-vert-border: #e2e2e2;
      --omega-vert-text: #16181d;
      --omega-vert-muted: #5a6270;
      --omega-vert-accent: ${accent.light};
      --omega-vert-accent-text: ${accent.lightText};
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --omega-vert-bg: #16181d;
      --omega-vert-border: #333333;
      --omega-vert-text: #f2f4f8;
      --omega-vert-muted: #9aa3b2;
      --omega-vert-accent: ${accent.dark};
      --omega-vert-accent-text: ${accent.darkText};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    /* The root stays transparent so ONLY the card paints. color-scheme above
       decides the canvas the browser falls back to whenever it rasterizes the
       frame without that transparency (first paint, a re-raster on scroll or
       zoom): light-mode white behind a dark card is the corner-notch bug. */
    html, body { background: transparent; }
    body { font-family: -apple-system, system-ui, sans-serif; }
    .omega-vert {
      display: block;
      background: var(--omega-vert-bg);
      border: 1px solid var(--omega-vert-border);
      border-radius: 10px;
      color: var(--omega-vert-text);
      overflow: hidden;
      text-decoration: none;
      padding: ${compact ? '6px 10px' : '10px 12px'};
      ${width ? `max-width: ${width}px;` : ''}
    }
    .omega-vert-row {
      display: flex;
      align-items: center;
      gap: ${compact ? '8px' : '10px'};
      ${stacked ? 'flex-direction: column; align-items: flex-start;' : ''}
    }
    .omega-vert-thumb {
      display: block;
      flex: 0 0 auto;
      width: ${stacked ? '100%' : `${thumbPx}px`};
      height: ${thumbPx}px;
      border-radius: 8px;
      overflow: hidden;
      line-height: 0;
    }
    .omega-vert-image { display: block; width: 100%; height: 100%; object-fit: cover; }
    .omega-vert-copy { display: block; min-width: 0; }
    .omega-vert-title {
      display: block;
      font-size: ${compact ? '13px' : '14px'};
      font-weight: 600;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .omega-vert-description {
      display: -webkit-box;
      -webkit-line-clamp: ${stacked ? 2 : 1};
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-top: 2px;
      font-size: 12px;
      line-height: 1.35;
      color: var(--omega-vert-muted);
    }
    .omega-vert-rule {
      display: block;
      height: 1px;
      margin: ${compact ? '6px 0' : '10px 0'};
      background: var(--omega-vert-border);
    }
    .omega-vert-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .omega-vert-label { font-size: 11px; color: var(--omega-vert-muted); }
    .omega-vert-button {
      display: inline-block;
      flex: 0 0 auto;
      background: var(--omega-vert-accent);
      color: var(--omega-vert-accent-text);
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.2;
      padding: 6px 10px;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <a class="omega-vert" id="omega-vert" href="${escapeHtml(options.href)}" target="_blank" rel="noopener noreferrer sponsored">
    <span class="omega-vert-row">
      ${thumb}
      <span class="omega-vert-copy">
        <span class="omega-vert-title">${escapeHtml(options.title)}</span>
        ${description}
      </span>
    </span>
    <span class="omega-vert-rule"></span>
    <span class="omega-vert-foot">
      <span class="omega-vert-label">${escapeHtml(options.label || 'Sponsored')}</span>
      ${button}
    </span>
  </a>
  <script>
    (function () {
      var TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};
      var VERT_ID = ${JSON.stringify(id)};
      var card = document.getElementById('omega-vert');

      function post(message) {
        if (!window.parent || window.parent === window) return;
        window.parent.postMessage(message, TARGET_ORIGIN);
      }

      // The CARD's box is the reported height, never the root element's: the
      // frame arrives at the slot preset, so documentElement.scrollHeight can
      // never measure shorter than the frame and the host would never shrink.
      function reportDimensions() {
        var doc = document.documentElement;
        post({ type: ${JSON.stringify(MESSAGE_DIMENSIONS)}, id: VERT_ID, width: doc.scrollWidth, height: Math.ceil(card.getBoundingClientRect().height) });
      }

      window.addEventListener('load', reportDimensions);

      if (window.ResizeObserver) {
        new ResizeObserver(reportDimensions).observe(card);
      }

      card.addEventListener('click', function () {
        post({ type: ${JSON.stringify(MESSAGE_CLICK)}, id: VERT_ID });
      });
    })();
  </script>
</body>
</html>`;
}
