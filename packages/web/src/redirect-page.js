/**
 * The ONE shape of a GENERATED redirect page (#429 socials, #561 download and
 * extension shortlinks). Legacy UJM hand-maintained these as default pages in
 * `src/defaults/dist/redirects/**`; here they are source strings registered as
 * virtual templates on the same lane as the framework's default pages
 * (engine.js), so they ride `modules/utilities/redirect` (noindex +
 * sitemap-excluded by the layout) and a consumer page at the same permalink
 * takes that URL over.
 *
 * A brand never hand-writes one: the config block IS the declaration.
 */

// A YAML double-quoted scalar (the dynamic-pages spelling).
const yaml = (value) => JSON.stringify(String(value));

/**
 * One generated redirect page.
 * @param {object} page
 * @param {string} page.virtual - the virtual template path (its identity in the build)
 * @param {string} page.label - what generated it, for logs and collision reports
 * @param {string} page.url - the permalink
 * @param {string} page.redirect - where it sends the visitor
 * @param {string} page.note - the source comment written into the page
 * @returns {{ virtual: string, label: string, url: string, raw: string }}
 */
function redirectPage({ virtual, label, url, redirect, note }) {
  return {
    virtual,
    label,
    url,
    raw: [
      '---',
      'layout: modules/utilities/redirect',
      `permalink: ${url}`,
      '',
      `# ${note}`,
      'redirect:',
      `  url: ${yaml(redirect)}`,
      '---',
      '',
    ].join('\n'),
  };
}

module.exports = { redirectPage };
