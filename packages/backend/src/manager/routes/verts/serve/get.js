/**
 * GET /omega/verts/serve - Serve a house vert unit (public)
 *
 * Query params:
 *   parent — the requesting page's host (eligibility + postMessage origin + UTM source fallback)
 *   brand  — the requesting brand's id (becomes the click's utm_source)
 *   tags   — comma-separated contextual tags (targeting match input)
 *   width  — optional unit width hint (px)
 *   height — optional unit height hint (px)
 *   theme  — optional 'light' | 'dark' (defaults to prefers-color-scheme)
 *   vertId   — optional pin to a specific vert (served only if eligible)
 *
 * Selection: eligibility (enabled + whitelist/blacklist + never-advertise-self)
 * → contextual match score (vert targeting tags vs request tags) → weighted
 * random among the top scorers. Responds with a self-contained HTML vert unit
 * (inline CSS/JS, postMessage reporting, no self-refresh — the host owns the
 * lifecycle), or 204 on no fill.
 */
const { getInventory, selectVert, normalizeHost, normalizeOrigin, normalizeBrandId, parseTags, renderVertUnit } = require('../utils.js');

module.exports = async ({ ctx, Manager, settings, analytics }) => {

  const parentHost = normalizeHost(settings.parent);
  const brandId = normalizeBrandId(settings.brand);
  const tags = parseTags(settings.tags);

  // Select from the cached inventory
  const verts = await getInventory(Manager);
  const vert = selectVert(verts, { parentHost, tags, vertId: settings.vertId });

  // No fill — the host's fallback ladder moves on
  if (!vert) {
    return ctx.respond('', { code: 204 });
  }

  // Clicks route through the fail-closed redirect (UTM'd, stored link only)
  const redirectUrl = new URL(`${Manager.getApiUrl()}/omega/verts/redirect`);
  redirectUrl.searchParams.set('id', vert.id);

  if (parentHost) {
    redirectUrl.searchParams.set('parent', parentHost);
  }

  // The host brand's id rides through to the click: the redirect route tags
  // the stored link with it as utm_source (parent host is the fallback)
  if (brandId) {
    redirectUrl.searchParams.set('brand', brandId);
  }

  // Track the view server-side (Analytics lane — no gtag inside the frame)
  analytics.event('verts/serve', { action: 'view', vertId: vert.id, parent: parentHost });

  ctx.log('verts/serve: Serving vert', { vertId: vert.id, parent: parentHost, tags });

  const html = await renderVertUnit({
    vert,
    redirectUrl: redirectUrl.toString(),
    // Port-preserving origin from the RAW parent param — normalizeHost strips
    // ports (right for eligibility/UTM, wrong for postMessage targeting)
    parentOrigin: normalizeOrigin(settings.parent),
    width: settings.width,
    height: settings.height,
    theme: settings.theme,
  });

  return ctx.respond(html, { log: false });
};
