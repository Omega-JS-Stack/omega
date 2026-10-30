/**
 * The one case table for `resolvedBrandHost(config)`, read by config's suite
 * and the web dev palette's, so both surfaces answer from the same rows.
 * `host: ''` means no brand host is known: the palette falls back to the page.
 */
module.exports = [
  {
    name: 'brand.url answers first, over the instance url',
    config: { url: 'https://admin.omegajs.dev', brand: { url: 'https://playground.omegajs.dev' } },
    host: 'playground.omegajs.dev',
  },
  {
    name: 'the top-level url is the fallback when no brand.url is set',
    config: { url: 'https://second.omegajs.dev' },
    host: 'second.omegajs.dev',
  },
  {
    name: 'a scheme-less brand.url still resolves, lowercased',
    config: { brand: { url: 'Switchboard.StreamForge.app' } },
    host: 'switchboard.streamforge.app',
  },
  {
    name: 'an unparseable brand.url gives the empty host',
    config: { brand: { url: 'https://exa mple.com' } },
    host: '',
  },
  {
    name: 'no url at all gives the empty host',
    config: {},
    host: '',
  },
];
