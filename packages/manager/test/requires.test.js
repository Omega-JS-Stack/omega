// The REQUIRES registry read as data: it keeps only the manager's own fields
// (which service asks, the reason shown, what Disable writes, the Google
// scopes). When a key is asked, and which keys exist, live in the env schema
// of @omega.js/config, and the one function there answers what is missing.

const defineCases = require('@omega.js/devkit/test/define-cases');

const { ENV_SCHEMA, missingEnvKeys, validateConfig, setAtPath } = require('@omega.js/config');
const { REQUIRES, serviceInputs } = require('../src/config.js');

/**
 * Every [path, key, value] in a value, depth first, arrays included.
 * @param {*} value - Any value.
 * @param {string} [at] - The path so far.
 * @returns {Array<[string, string, *]>} The visited properties.
 */
function properties(value, at = '') {
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const here = at ? `${at}.${key}` : key;
    return [[here, key, child], ...properties(child, here)];
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'requires',
  tests: [
    {
      name: 'case 9: REQUIRES keeps only its own fields, no "when" and no key name',
      run: (ctx) => {
        const keyNames = new Set(ENV_SCHEMA.filter((entry) => entry.name).map((entry) => entry.name));

        for (const [service, row] of Object.entries(REQUIRES)) {
          const found = properties(row);

          ctx.expect(found.filter(([, key]) => key === 'when').map(([at]) => at), `REQUIRES.${service}: "when" lives in the env schema now`).toEqual([]);
          ctx.expect(found.filter(([, , value]) => typeof value === 'function').map(([at]) => at), `REQUIRES.${service}: the registry is data, no rule`).toEqual([]);
          ctx.expect(found.filter(([, key, value]) => keyNames.has(key) || (typeof value === 'string' && keyNames.has(value))).map(([at]) => at), `REQUIRES.${service}: key names live in the env schema now`).toEqual([]);
        }
      },
    },

    {
      name: 'case 9: every key manage asks for has a REQUIRES row for its service, with a label and a Disable path',
      run: (ctx) => {
        // One brand with every asking feature on
        const config = {
          brand: { id: 'b', name: 'B' },
          cloud: { provider: 'firebase', config: { projectId: 'b-live' } },
          domain: { providers: { namecheap: {} } },
          monitoring: { providers: { sentry: { org: 'b' } } },
          analytics: { providers: { google: { id: 'G-B123' }, meta: { id: '123' }, tiktok: { id: 'TT123' } } },
          advertising: { providers: { adsense: { client: 'ca-pub-1' } } },
          payment: { providers: { stripe: {}, paypal: {}, chargebee: {}, coinbase: { enabled: true } } },
          marketing: { campaigns: { providers: { sendgrid: {} } }, newsletter: { providers: { beehiiv: {} } } },
          targets: { web: { type: 'web' }, backend: { type: 'backend' }, desktop: { type: 'desktop' }, extension: { type: 'extension' } },
        };

        const asked = missingEnvKeys(config, {}, { verb: 'manage' }).filter((row) => row.need === 'asked');
        ctx.expect(asked.length > 10, `expected many asked keys, found ${asked.length}`).toBeTruthy();

        for (const row of asked) {
          const declaration = REQUIRES[row.service];
          ctx.expect(declaration, `${row.key}: its service "${row.service}" has a REQUIRES row`).toBeTruthy();
          ctx.expect(typeof declaration.label, `REQUIRES.${row.service} has a label`).toBe('string');
          ctx.expect(typeof declaration.disablePath, `REQUIRES.${row.service} has a Disable path`).toBe('string');
        }

        // Every key the schema says manage asks for is reached by that brand
        const reached = new Set(asked.map((row) => row.key));
        const unreached = ENV_SCHEMA.filter((entry) => entry.askedWhen && !reached.has(entry.name)).map((entry) => entry.name);
        ctx.expect(unreached).toEqual([]);
      },
    },

    {
      name: 'every Disable path in REQUIRES is a key the config schema accepts',
      run: (ctx) => {
        // "Disable permanently" writes false at this path, and the "on unless turned
        // off" rules read the same path: an undeclared one breaks the next load.
        // The service's own path, and each input's (a payment provider, a pixel)
        const paths = [...new Set(Object.keys(REQUIRES).flatMap((service) => properties({ row: REQUIRES[service], inputs: serviceInputs(service) })
          .filter(([, key, value]) => key === 'disablePath' && typeof value === 'string')
          .map(([, , value]) => value)))];
        ctx.expect(paths.length >= Object.keys(REQUIRES).length, `expected a Disable path per service, found ${paths.length}`).toBeTruthy();

        const rejected = {};
        for (const disablePath of paths) {
          const config = { brand: { id: 'disable-probe', name: 'Disable Probe' } };
          setAtPath(config, disablePath, false);

          const { errors } = validateConfig(config);
          if (errors.length > 0) rejected[disablePath] = errors;
        }

        ctx.expect(rejected).toEqual({});
      },
    },
  ],
});
