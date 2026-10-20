/**
 * The account page's USAGE CARDS (`core/js/pages/dashboard/account/sections/
 * billing.js`): what a customer is told about what they have left
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647),
 * [#833](https://github.com/Omega-JS-Stack/omega/issues/833)).
 *
 * The promises, all of them things a customer can be misled by:
 *  - one `.omega-usage-card` per COUNTED feature the catalog defines and the
 *    plan prices; a perk is not a meter and never draws one;
 *  - the month figure is the headline (`used of limit`), with a fill sized to
 *    the share used, warned at half and in danger past 80%;
 *  - a paced feature adds a day row, because a paced feature refuses on the
 *    day's share long before the month runs out; `pace: false` shows none;
 *  - each counter says WHEN it resets: the cron's UTC boundary, in local time;
 *  - override credits an admin granted are IN the headline's limit and named
 *    in a chip; a silent difference from /pricing reads as a bug;
 *  - unlimited says "Unlimited" instead of drawing a percentage of nothing;
 *  - theme tokens only: no Bootstrap progress, no color class, no inline color.
 *
 * Same harness as billing-plan-switcher.test.js: the REAL module through
 * esbuild behind its bundler aliases, over a document that answers only the
 * ids the usage section writes, and the assertion is the HTML it wrote. The
 * accounts are the usage persona's five states (`USAGE_SPREAD_STATES` in
 * @omega.js/backend's test-accounts.js), on a 3,100-a-month feature.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { User, dayShare } = require('@omega.js/account');

const CORE_DIR = path.join(__dirname, '..', 'core');
const BILLING_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'billing.js');
const ACCOUNT_LAYOUT = path.join(__dirname, '..', 'themes', 'base', '_layouts', 'frontend', 'pages', 'account', 'index.html');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-billing-usage-'));
const BUNDLE = path.join(BUNDLE_DIR, 'billing.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [BILLING_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return { contents: 'export class FormManager {}' };
        });
      },
    }],
  });

  return building;
}

// The FEATURES CATALOG: `saves` is counted and paced (the default), `exports`
// is counted but opted out of pacing, `support` is a perk.
// A catalog `icon` carries the FULL Font Awesome class string (#929), so a
// brand can name any family its set carries: `saves` proves a brand mark.
const FEATURE_CATALOG = {
  saves: { name: 'Saves', icon: 'fa-brands fa-figma', definition: 'Notes you can save each month.', usage: {} },
  exports: { name: 'Exports', icon: 'fa-solid fa-file-export', usage: { pace: false } },
  support: { name: 'Priority support', icon: 'fa-solid fa-headset' },
};

const PAYMENT_CONFIG = {
  currency: 'USD',
  products: [
    { id: 'basic', name: 'Basic', type: 'subscription', prices: {}, features: { saves: 100 } },
    {
      id: 'premium',
      name: 'Premium',
      type: 'subscription',
      prices: { monthly: 10 },
      features: { saves: 3100, exports: 50, support: true },
    },
  ],
};

function makeElement() {
  return { innerHTML: '', listeners: {}, addEventListener() {}, querySelectorAll: () => [] };
}

function paidAccount(usage) {
  return new User({
    subscription: {
      product: { id: 'premium' },
      status: 'active',
      expires: { timestampUNIX: Math.floor(Date.now() / 1000) + 86400 },
    },
    usage: usage,
  }, { uid: 'user-647' });
}

/** Render the usage section for an account and hand back the HTML it wrote. */
async function renderUsage(account, config) {
  await bundleOnce();

  const elements = {
    'usage-metrics-container': makeElement(),
    'change-plan-modal': makeElement(),
    'change-plan-cadence': makeElement(),
    'change-plan-options': makeElement(),
    'change-plan-confirm-btn': makeElement(),
  };

  globalThis.document = {
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.window = { location: { search: '', href: 'https://x.test/account' }, history: { replaceState() {} }, addEventListener() {} };
  globalThis.bootstrap = { Tooltip: class { static getInstance() { return null; } dispose() {} }, Modal: class { show() {} hide() {} static getOrCreateInstance() { return { show() {}, hide() {} }; } } };
  globalThis.__omegaClient = {
    config: { features: FEATURE_CATALOG },
    library: () => ({ motion: { scan: () => {} } }),
    bindings: { update: () => {} },
    utilities: { showNotification: () => {}, escapeHTML: (value) => `${value}` },
    request: async () => ({}),
  };

  delete require.cache[require.resolve(BUNDLE)];
  const billing = require(BUNDLE);

  await billing.init();
  await billing.loadData(account, config || PAYMENT_CONFIG);

  return elements['usage-metrics-container'].innerHTML;
}

/** Every opening tag in the HTML, with its class tokens and its style attribute. */
function tags(html) {
  return [...html.matchAll(/<[a-z][a-z0-9]*\b[^>]*>/g)].map((match) => {
    const cls = match[0].match(/\bclass="([^"]*)"/);
    const style = match[0].match(/\bstyle="([^"]*)"/);
    return {
      index: match.index,
      classes: cls ? cls[1].split(/\s+/).filter(Boolean) : [],
      style: style ? style[1] : null,
    };
  });
}

/** Each `.omega-usage-card`: its class tokens, its markup up to the next card, and the text it reads as. */
function cards(html) {
  const starts = tags(html).filter((tag) => tag.classes.includes('omega-usage-card'));
  return starts.map((tag, i) => {
    const markup = html.slice(tag.index, i + 1 < starts.length ? starts[i + 1].index : html.length);
    return { classes: tag.classes, html: markup, text: markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') };
  });
}

/** The one card naming a feature; fails loudly when there is none or several. */
function cardFor(html, name) {
  const found = cards(html).filter((card) => card.html.includes(name));
  if (found.length !== 1) {
    throw new Error(`expected one usage card for ${name}, found ${found.length}: ${html}`);
  }
  return found[0];
}

/** The fill's width in percent, or null when the card draws no fill. */
function fillWidth(card) {
  const fill = tags(card.html).find((tag) => tag.classes.includes('omega-usage-card__fill'));
  if (!fill) return null;
  const width = (fill.style || '').match(/width:\s*([\d.]+)%/);
  return width ? Number(width[1]) : NaN;
}

// The cron's UTC boundaries, formatted the way the viewer's browser shows them
const nextUtcDay = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
};
const nextUtcMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
};
const dayResetText = () => `Day resets ${nextUtcDay().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`.replace(/\s+/g, ' ');
const monthResetText = () => `Month resets ${nextUtcMonth().toLocaleDateString([], { month: 'short', day: 'numeric' })}`.replace(/\s+/g, ' ');

// The usage persona's five states on `saves` (3,100 a month); `exports` stays
// untouched beside it
const SAVES_LIMIT = 3100;
const PERSONA_STATES = {
  'untouched': { saves: { monthly: 0, daily: 0 } },
  'half spent': { saves: { monthly: 1550, daily: 0 } },
  'day cap hit': { saves: { monthly: 775, daily: dayShare(SAVES_LIMIT) } },
  'month cap hit': { saves: { monthly: 3100, daily: 0 } },
  'override credits': { saves: { monthly: 3100, daily: 0 }, overrides: { saves: 6200 } },
};

module.exports = defineCases({
  type: 'group',
  description: 'billing-usage-bars',
  tests: [
    {
      name: 'usage cards: a card per counted feature, named and iconed from the catalog',
      run: async (ctx) => {
        const html = await renderUsage(paidAccount(PERSONA_STATES['untouched']));

        ctx.expect(cards(html).length, `saves and exports, never the perk: ${html}`).toBe(2);
        ctx.expect(cardFor(html, 'Saves').html.includes('class="fa-brands fa-figma'), 'the catalog icon, emitted exactly as authored (#929)').toBeTruthy();
        ctx.expect(!html.includes('fa-solid fa-fa-'), 'and never re-wrapped by the card').toBeTruthy();
        ctx.expect(!html.includes('Priority support'), 'a perk draws no card').toBeTruthy();

        // The real layout lays the cards out: the container the section writes into is the grid
        const container = fs.readFileSync(ACCOUNT_LAYOUT, 'utf8').match(/<[a-z][a-z0-9]*\b[^>]*\bid="usage-metrics-container"[^>]*>/);
        const containerClasses = container ? tags(container[0])[0].classes : [];
        ctx.expect(containerClasses.includes('omega-usage-grid'), `the layout's usage container: ${container && container[0]}`).toBeTruthy();
      },
    },

    {
      name: '#833 case 1: half spent on a paced feature: the month headline, a 50% warn fill, a day row',
      run: async (ctx) => {
        const saves = cardFor(await renderUsage(paidAccount(PERSONA_STATES['half spent'])), 'Saves');

        ctx.expect(saves.text.includes('1,550 of 3,100'), `the month figure is the headline: ${saves.html}`).toBeTruthy();
        ctx.expect(fillWidth(saves), 'the fill is the share used').toBe(50);
        ctx.expect(saves.classes.includes('omega-usage-card--warn'), `half spent warns: ${saves.classes}`).toBeTruthy();
        ctx.expect(!saves.classes.includes('omega-usage-card--danger'), 'and is not yet danger').toBeTruthy();
        ctx.expect(/left today/.test(saves.text), 'a paced feature carries a day row').toBeTruthy();
        ctx.expect(saves.text.includes(dayResetText()), `with the day's reset: ${saves.html}`).toBeTruthy();
      },
    },

    {
      name: '#833 case 2: a feature that opted out of pacing has no day row and no day reset',
      run: async (ctx) => {
        const exports_ = cardFor(await renderUsage(paidAccount({ exports: { monthly: 10, daily: 10 } })), 'Exports');

        ctx.expect(exports_.text.includes('10 of 50'), `the month headline: ${exports_.html}`).toBeTruthy();
        ctx.expect(!exports_.text.includes('left today'), 'no day cap exists, so no day row').toBeTruthy();
        ctx.expect(!exports_.text.includes('Day resets'), 'and no day reset').toBeTruthy();
      },
    },

    {
      name: "#833 case 3: day cap hit: nothing left today, and when the day resets in the viewer's time",
      run: async (ctx) => {
        const saves = cardFor(await renderUsage(paidAccount(PERSONA_STATES['day cap hit'])), 'Saves');

        // 3,100 a month over a 28-31 day month is 100..111 a day
        const day = saves.text.match(/(\d[\d,]*) of (\d[\d,]*) left today/);
        ctx.expect(day && day[1], `the day row: ${saves.html}`).toBe('0');
        ctx.expect(Number(day[2]) >= 100 && Number(day[2]) <= 111, `today's share: ${day[2]}`).toBeTruthy();
        ctx.expect(saves.text.includes(dayResetText()), `expected "${dayResetText()}": ${saves.html}`).toBeTruthy();
        ctx.expect(saves.text.includes('775 of 3,100'), 'the month still has room').toBeTruthy();
      },
    },

    {
      name: '#833 case 4: month cap hit: a full danger fill and the month reset date',
      run: async (ctx) => {
        const saves = cardFor(await renderUsage(paidAccount(PERSONA_STATES['month cap hit'])), 'Saves');

        ctx.expect(saves.text.includes('3,100 of 3,100'), `the headline: ${saves.html}`).toBeTruthy();
        ctx.expect(fillWidth(saves), 'the fill is full').toBe(100);
        ctx.expect(saves.classes.includes('omega-usage-card--danger'), `a spent month is danger: ${saves.classes}`).toBeTruthy();
        ctx.expect(saves.text.includes(monthResetText()), `expected "${monthResetText()}": ${saves.html}`).toBeTruthy();
      },
    },

    {
      name: '#833 case 5: override credits are IN the headline limit and named in a chip',
      run: async (ctx) => {
        const saves = cardFor(await renderUsage(paidAccount(PERSONA_STATES['override credits'])), 'Saves');

        ctx.expect(saves.text.includes('3,100 of 6,200'), `the override is the limit that counts: ${saves.html}`).toBeTruthy();
        ctx.expect(saves.text.includes('+3,100 credits'), 'and the extra credits are named, not silently folded in').toBeTruthy();
      },
    },

    {
      name: 'usage cards: an override AT or BELOW the plan sets the limit and claims no credit',
      run: async (ctx) => {
        // An override is not always a grant: support can also DIAL A PLAN DOWN for
        // one account, and a negative difference must never read as a gift.
        const lower = cardFor(await renderUsage(paidAccount({
          saves: { monthly: 100, daily: 0 },
          overrides: { saves: 500 },
        })), 'Saves');

        ctx.expect(lower.text.includes('100 of 500'), `the override is still the limit that counts: ${lower.html}`).toBeTruthy();
        ctx.expect(!lower.text.includes('credits'), 'but nothing was granted, so no chip claims it was').toBeTruthy();
        ctx.expect(!lower.text.includes('+-'), 'and no negative is dressed up as a credit').toBeTruthy();

        const equal = cardFor(await renderUsage(paidAccount({
          saves: { monthly: 100, daily: 0 },
          overrides: { saves: 3100 },
        })), 'Saves');

        ctx.expect(!equal.text.includes('credits'), 'an override equal to the plan grants nothing either').toBeTruthy();
      },
    },

    {
      name: '#833 case 6: unlimited says so, with no fill and no reset rows',
      run: async (ctx) => {
        const html = await renderUsage(paidAccount({ saves: { monthly: 90000, daily: 10 } }), {
          currency: 'USD',
          products: [{ id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10 }, features: { saves: -1 } }],
        });
        const saves = cardFor(html, 'Saves');

        ctx.expect(saves.text.includes('Unlimited'), `unlimited is stated: ${saves.html}`).toBeTruthy();
        ctx.expect(fillWidth(saves), 'no percentage of nothing').toBe(null);
        ctx.expect(!saves.text.includes('Day resets') && !saves.text.includes('Month resets'), 'nothing to reset').toBeTruthy();
        ctx.expect(!saves.text.includes('left today'), 'and no day share to be refused by').toBeTruthy();
        ctx.expect(!html.includes('NaN') && !html.includes('Infinity'), 'and no arithmetic leaks').toBeTruthy();
      },
    },

    {
      name: '#833 case 7: a plan that meters nothing says so',
      run: async (ctx) => {
        const html = await renderUsage(new User({
          subscription: { product: { id: 'basic' }, status: 'active' },
          usage: {},
        }, { uid: 'user-647' }), { currency: 'USD', products: [{ id: 'basic', name: 'Basic', type: 'subscription', prices: {}, features: { support: true } }] });

        ctx.expect(html.includes('Usage tracking not available for this plan.'), html).toBeTruthy();
      },
    },

    {
      name: '#833 case 9: every persona state renders from theme tokens: no Bootstrap progress, no color class, no inline color',
      run: async (ctx) => {
        const FORBIDDEN = ['bg-success', 'bg-warning', 'bg-danger', 'progress', 'progress-bar'];

        for (const [state, usage] of Object.entries(PERSONA_STATES)) {
          const html = await renderUsage(paidAccount(usage));
          ctx.expect(cards(html).length, `${state}: the cards rendered`).toBe(2);

          for (const tag of tags(html)) {
            const bad = tag.classes.filter((name) => FORBIDDEN.includes(name));
            ctx.expect(bad, `${state}: a forbidden class`).toEqual([]);
            if (tag.style === null) continue;
            ctx.expect(/^\s*width:\s*[\d.]+%;?\s*$/.test(tag.style), `${state}: the fill's width is the one inline value, not "${tag.style}"`).toBeTruthy();
            ctx.expect(tag.classes.includes('omega-usage-card__fill'), `${state}: only the fill carries a style`).toBeTruthy();
          }
        }
      },
    },

    {
      name: '#945: the cards read the plan off the User: a cancelled paid plan draws the basic limits',
      run: async (ctx) => {
        const html = await renderUsage(new User({
          subscription: { product: { id: 'premium' }, status: 'cancelled' },
          usage: { saves: { monthly: 40, daily: 5 } },
        }, { uid: 'user-647' }));

        ctx.expect(cardFor(html, 'Saves').text.includes('40 of 100'), `the basic plan's number, not premium's: ${html}`).toBeTruthy();
        ctx.expect(!html.includes('Exports'), 'and none of the premium-only meters').toBeTruthy();
      },
    },
  ],
});
