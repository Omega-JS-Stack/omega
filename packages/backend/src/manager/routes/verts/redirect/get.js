/**
 * GET /omega/verts/redirect - Fail-closed vert click redirect (public)
 *
 * Query params:
 *   id     — the vert to redirect for (required)
 *   parent — the referring host (becomes utm_source when given)
 *
 * Looks the vert up by id and 302s to ITS stored link only — never to a
 * caller-supplied URL. Unknown id (or a vert without a valid http(s) link)
 * → 404. UTM params: utm_source=<parent host, if given>, utm_medium=vert,
 * utm_campaign=<vertId>.
 */
const { getVertById, normalizeHost, isHttpUrl } = require('../utils.js');

module.exports = async ({ assistant, Manager, settings, analytics }) => {

  const vert = await getVertById(Manager, settings.id);

  // Fail closed — only a known vert's own stored link ever redirects
  if (!vert || !isHttpUrl(vert.link)) {
    return assistant.respond('Vert not found', { code: 404 });
  }

  const parentHost = normalizeHost(settings.parent);
  const url = new URL(vert.link);

  if (parentHost) {
    url.searchParams.set('utm_source', parentHost);
  }

  url.searchParams.set('utm_medium', 'vert');
  url.searchParams.set('utm_campaign', vert.id);

  // Track the click server-side (Analytics lane — no gtag inside the frame)
  analytics.event('verts/redirect', { action: 'click', vertId: vert.id, parent: parentHost });

  assistant.log('verts/redirect: Redirecting', { vertId: vert.id, url: url.toString() });

  return assistant.redirect(url.toString());
};
