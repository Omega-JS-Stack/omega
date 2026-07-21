/**
 * GET /omega/ads/serve - Serve a house ad unit (public)
 *
 * Query params:
 *   parent — the requesting page's host (eligibility + postMessage origin + UTM source)
 *   tags   — comma-separated contextual tags (targeting match input)
 *   width  — optional unit width hint (px)
 *   height — optional unit height hint (px)
 *   theme  — optional 'light' | 'dark' (defaults to prefers-color-scheme)
 *   adId   — optional pin to a specific ad (served only if eligible)
 *
 * Selection: eligibility (enabled + whitelist/blacklist + never-advertise-self)
 * → contextual match score (ad targeting tags vs request tags) → weighted
 * random among the top scorers. Responds with a self-contained HTML ad unit
 * (inline CSS/JS, postMessage reporting, no self-refresh — the host owns the
 * lifecycle), or 204 on no fill.
 */
const { getInventory, selectAd, normalizeHost, normalizeOrigin, parseTags, renderAdUnit } = require('../utils.js');

module.exports = async ({ assistant, Manager, settings, analytics }) => {

  const parentHost = normalizeHost(settings.parent);
  const tags = parseTags(settings.tags);

  // Select from the cached inventory
  const ads = await getInventory(Manager);
  const ad = selectAd(ads, { parentHost, tags, adId: settings.adId });

  // No fill — the host's fallback ladder moves on
  if (!ad) {
    return assistant.respond('', { code: 204 });
  }

  // Clicks route through the fail-closed redirect (UTM'd, stored link only)
  const redirectUrl = new URL(`${Manager.getApiUrl()}/omega/ads/redirect`);
  redirectUrl.searchParams.set('id', ad.id);

  if (parentHost) {
    redirectUrl.searchParams.set('parent', parentHost);
  }

  // Track the view server-side (Analytics lane — no gtag inside the frame)
  analytics.event('ads/serve', { action: 'view', adId: ad.id, parent: parentHost });

  assistant.log('ads/serve: Serving ad', { adId: ad.id, parent: parentHost, tags });

  const html = renderAdUnit({
    ad,
    redirectUrl: redirectUrl.toString(),
    // Port-preserving origin from the RAW parent param — normalizeHost strips
    // ports (right for eligibility/UTM, wrong for postMessage targeting)
    parentOrigin: normalizeOrigin(settings.parent),
    width: settings.width,
    height: settings.height,
    theme: settings.theme,
  });

  return assistant.respond(html, { log: false });
};
