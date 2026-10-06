/**
 * Region detection (`core/js/libs/consent-region.js`, #383) — the heuristic
 * that decides whether a visitor is asked BEFORE anything loads (opt-in) or
 * told after (opt-out).
 *
 * The zone list has to hold on its own, because getting it wrong in the
 * permissive direction means loading a tracker on someone the law protects.
 * The shapes that matter: `Europe/*`, the strict roster's named zones outside
 * that prefix (the four Atlantic ones, then Brazil, China, South Korea), the
 * countries deliberately NOT on it, and everything the runtime cannot place at
 * all — which is opt-in too, on purpose.
 *
 * Browser code behind no aliases, but driven through esbuild like every other
 * core/js suite so the REAL file is what runs.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_JS = path.join(__dirname, '..', 'core', 'js');
const ENTRY = path.join(CORE_JS, 'libs', 'consent-region.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-consent-region-'));
const BUNDLE = path.join(BUNDLE_DIR, 'consent-region.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
  });

  return building;
}

async function load() {
  await bundleOnce();
  delete require.cache[require.resolve(BUNDLE)];
  return require(BUNDLE);
}

module.exports = defineCases({
  type: 'group',
  description: 'consent-region',
  tests: [
    {
      name: 'every Europe/* zone is opt-in',
      run: async (ctx) => {
        const { requiresOptIn } = await load();

        for (const zone of ['Europe/Berlin', 'Europe/Paris', 'Europe/Dublin', 'Europe/London', 'Europe/Lisbon', 'Europe/Warsaw']) {
          ctx.expect(requiresOptIn(zone), `${zone} needs consent before anything loads`).toBe(true);
        }

        // Zone names are matched case-insensitively, because Intl accepts them that
        // way: a case-sensitive prefix test read `europe/berlin` as unplaceable, and
        // "unplaceable" is the branch that then has to guess.
        ctx.expect(requiresOptIn('europe/berlin'), 'casing never changes the answer').toBe(true);
      },
    },

    {
      name: 'the four EEA zones outside the Europe/ prefix are opt-in too',
      run: async (ctx) => {
        const { requiresOptIn } = await load();

        // The prefix alone misses these: Iceland, the Canaries, Madeira, the Azores.
        for (const zone of ['Atlantic/Reykjavik', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores']) {
          ctx.expect(requiresOptIn(zone), `${zone} is in the EEA`).toBe(true);
        }
      },
    },

    {
      name: 'Brazil is opt-in (LGPD), every one of its zones',
      run: async (ctx) => {
        const { requiresOptIn } = await load();

        // Brazil spans four offsets and sixteen IANA zones; the roster carries all of
        // them, because a São Paulo rule that misses Manaus is not a rule.
        for (const zone of [
          'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife',
          'America/Araguaina', 'America/Maceio', 'America/Belem', 'America/Santarem',
          'America/Campo_Grande', 'America/Cuiaba', 'America/Boa_Vista', 'America/Porto_Velho',
          'America/Manaus', 'America/Eirunepe', 'America/Rio_Branco', 'America/Noronha',
        ]) {
          ctx.expect(requiresOptIn(zone), `${zone} is Brazil, and the LGPD wants the question first`).toBe(true);
        }
      },
    },

    {
      name: 'China is opt-in (PIPL)',
      run: async (ctx) => {
        const { requiresOptIn } = await load();

        for (const zone of ['Asia/Shanghai', 'Asia/Urumqi']) {
          ctx.expect(requiresOptIn(zone), `${zone} is China`).toBe(true);
        }
      },
    },

    {
      name: 'South Korea is opt-in (PIPA)',
      run: async (ctx) => {
        const { requiresOptIn } = await load();

        ctx.expect(requiresOptIn('Asia/Seoul'), 'Seoul is South Korea').toBe(true);
      },
    },

    {
      name: 'the rest of the world is opt-out',
      run: async (ctx) => {
        const { requiresOptIn } = await load();

        for (const zone of ['America/New_York', 'America/Los_Angeles', 'America/Toronto', 'Asia/Tokyo', 'Australia/Sydney', 'Africa/Cairo', 'UTC']) {
          ctx.expect(requiresOptIn(zone), `${zone} loads its scripts and gets the informational banner`).toBe(false);
        }

        // Canada is the roster's clearest "stay out": Quebec's Law 25 is real, but
        // America/Montreal is an ALIAS of America/Toronto, so an opt-in Quebec would
        // drag every Ontario visitor in with it — no zone, no entry.
        ctx.expect(requiresOptIn('America/Montreal'), 'Quebec cannot be isolated from Toronto').toBe(false);
      },
    },

    {
      name: 'a missing or unplaceable timezone fails toward compliance',
      run: async (ctx) => {
        const { requiresOptIn } = await load();

        // Missing: the browser had no answer for us — which is what detectTimeZone()
        // hands back when Intl is absent or throws.
        for (const value of ['', '   ', null, 42]) {
          ctx.expect(requiresOptIn(value), `${JSON.stringify(value)} tells us nothing, so we ask first`).toBe(true);
        }

        // Unplaceable: a string that is not a zone the runtime knows tells us nothing
        // either — reading it as "not Europe" is the one guess that costs something.
        for (const zone of ['Mars/Olympus', 'Nowhere', 'Europe']) {
          ctx.expect(requiresOptIn(zone), `${zone} is not a zone we can place`).toBe(true);
        }
      },
    },

    {
      name: 'detectRegion names the regime the consent record stores',
      run: async (ctx) => {
        const { detectRegion } = await load();

        ctx.expect(detectRegion('Europe/Berlin')).toBe('opt-in');
        ctx.expect(detectRegion('America/New_York')).toBe('opt-out');
        ctx.expect(detectRegion('')).toBe('opt-in');
      },
    },

    {
      name: 'with no argument it reads the environment\'s own timezone',
      run: async (ctx) => {
        const { requiresOptIn, detectTimeZone } = await load();
        const original = process.env.TZ;

        try {
          process.env.TZ = 'Europe/Berlin';
          ctx.expect(detectTimeZone()).toBe('Europe/Berlin');
          ctx.expect(requiresOptIn(), 'a Berlin browser is opt-in without being told').toBe(true);

          process.env.TZ = 'America/New_York';
          ctx.expect(requiresOptIn(), 'a New York browser is opt-out').toBe(false);
        } finally {
          process.env.TZ = original;
        }
      },
    },
  ],
});
