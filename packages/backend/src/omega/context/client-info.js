/**
 * Client info — one reader over the request headers for everything we know
 * about the caller: geolocation (Cloudflare/App Engine header vocabulary) and
 * client traits (user agent, language, platform, mobile, origin URL).
 *
 * getClient() replaces the legacy 13 per-field getHeader* prototype methods
 * (cp263) — init() splits its result into request.geolocation + request.client.
 */

function getClient(headers, req) {
  headers = headers || {};

  return {
    ip: first(
      // these are present for cloudflare requests (11/21/2020)
      headers['cf-connecting-ip']
      || headers['fastly-temp-xff']

      // these are present for non-cloudflare requests (11/21/2020)
      || headers['x-appengine-user-ip']
      || headers['x-forwarded-for']
    ),

    continent: first(headers['cf-ipcontinent']),

    country: first(
      headers['cf-ipcountry']
      || headers['x-country-code']
      || headers['x-appengine-country']
    ),

    region: first(
      headers['cf-region']
      || headers['x-appengine-region']
    ),

    city: first(
      headers['cf-ipcity']
      || headers['x-appengine-city']
    ),

    latitude: parseFloat((
      headers['cf-iplatitude']
      || (headers['x-appengine-citylatlong'] || '').split(',')[0]
      || '0'
    ).split(',')[0].trim()),

    longitude: parseFloat((
      headers['cf-iplongitude']
      || (headers['x-appengine-citylatlong'] || '').split(',')[1]
      || '0'
    ).split(',')[0].trim()),

    userAgent: trimmed(headers['user-agent']),

    language: trimmed(
      headers['accept-language']
      || headers['x-orig-accept-language']
    ),

    platform: headers['sec-ch-ua-platform']
      ? headers['sec-ch-ua-platform'].replace(/"/ig, '').trim()
      : null,

    // Will be ?0 if false or ?1 if true
    mobile: ['1', 'true', true].includes((headers['sec-ch-ua-mobile'] || '').replace(/\?/ig, '')),

    url: trimmed(
      // Origin header (most reliable for CORS requests)
      headers['origin']

      // Fallback to referrer/referer
      || headers['referrer']
      || headers['referer']

      // Reconstruct from host and path if available
      || (headers['host'] ? `https://${headers['host']}${req?.originalUrl || req?.url || ''}` : null)
    ),
  };
}

// Multi-value headers (comma-joined proxies) resolve to their first entry
function first(value) {
  return value ? value.split(',')[0].trim() : null;
}

function trimmed(value) {
  return value ? value.trim() : null;
}

module.exports = { getClient };
