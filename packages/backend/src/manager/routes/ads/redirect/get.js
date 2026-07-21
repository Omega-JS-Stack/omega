/**
 * GET /omega/ads/redirect - Fail-closed ad click redirect (public)
 *
 * Query params:
 *   id     — the ad to redirect for (required)
 *   parent — the referring host (becomes utm_source when given)
 *
 * Looks the ad up by id and 302s to ITS stored link only — never to a
 * caller-supplied URL. Unknown id (or an ad without a valid http(s) link)
 * → 404. UTM params: utm_source=<parent host, if given>, utm_medium=ad,
 * utm_campaign=<adId>.
 */
const { getAdById, normalizeHost, isHttpUrl } = require('../utils.js');

module.exports = async ({ assistant, Manager, settings, analytics }) => {

  const ad = await getAdById(Manager, settings.id);

  // Fail closed — only a known ad's own stored link ever redirects
  if (!ad || !isHttpUrl(ad.link)) {
    return assistant.respond('Ad not found', { code: 404 });
  }

  const parentHost = normalizeHost(settings.parent);
  const url = new URL(ad.link);

  if (parentHost) {
    url.searchParams.set('utm_source', parentHost);
  }

  url.searchParams.set('utm_medium', 'ad');
  url.searchParams.set('utm_campaign', ad.id);

  // Track the click server-side (Analytics lane — no gtag inside the frame)
  analytics.event('ads/redirect', { action: 'click', adId: ad.id, parent: parentHost });

  assistant.log('ads/redirect: Redirecting', { adId: ad.id, url: url.toString() });

  return assistant.redirect(url.toString());
};
