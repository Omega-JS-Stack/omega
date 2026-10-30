/**
 * `isSitePath(value)`: the ONE return-path rule. The backend's connections
 * route refuses a `returnUrl` that breaks it, and the web callback page checks
 * the value the wire hands back before it assigns it to `location`; both read
 * this function, so the two checks can never drift apart.
 *
 * A site path is a string that starts with ONE `/` and goes nowhere else: every
 * refused row below is a way of leaving the site with a value that starts out
 * looking like a path.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { isSitePath } = require('../src/modules/site-path.js');

// [value, verdict, what the row proves]
const TABLE = [
  ['/dashboard/channels', true, 'a path on this site'],
  ['/dashboard/channels?tab=live#connections', true, 'its query and hash ride along'],
  ['https://evil.test/steal', false, 'an absolute URL is another site'],
  ['//evil.test/steal', false, 'a protocol-relative //host is another site'],
  ['/\\evil.test/steal', false, 'a browser reads /\\host as //host'],
  ['javascript:alert(1)', false, 'a javascript: scheme runs instead of navigating'],
  [' /dashboard/channels', false, 'leading whitespace is not a path'],
  [undefined, false, 'a missing value is no path'],
  [null, false, 'null is no path'],
  [42, false, 'a number is no path'],
  [{ toString: () => '/dashboard' }, false, 'an object is no path, whatever it stringifies to'],
];

module.exports = defineCases({
  type: 'group',
  description: 'site-path',
  tests: TABLE.map(([value, verdict, proves]) => ({
    name: `${typeof value === 'string' ? JSON.stringify(value) : String(value)} -> ${verdict}: ${proves}`,
    run: (ctx) => {
      ctx.expect(isSitePath(value)).toBe(verdict);
    },
  })),
});
