/**
 * The comparison matrix reads a catalog value the way the plan cards do
 * (#562).
 *
 * A product's `features` value of "Included" — the legacy catalog word,
 * verbatim — rendered two ways from ONE catalog: the plan cards printed the
 * label beside their check, and the matrix fell through to the bare
 * `omega_commaify` branch (only `_cell == true` drew an icon), so a row mixed
 * the word "Included" with `circle-xmark` icons for the negative cells. Legacy
 * UJM drew a green check for the same data, and no single catalog value
 * satisfied both surfaces — setting `true` blanks the card labels.
 *
 * Ruling (manager, 2026-08-25): the matrix treats a truthy non-`true` cell as a
 * YES with a label — the check icon plus the value — which is exactly the shape
 * the cards already render. `true` stays icon-only, falsy stays the x icon. No
 * schema change.
 *
 * The fixture speaks the #647 shape: a feature is DEFINED once in the
 * top-level `features` catalog and each product names only its VALUE, so the
 * cell kinds this file walks are a perk string, a counted number, the `-1`
 * unlimited sentinel, a bare `true`, and a feature a tier does not name.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData) => sharedBuildWith(siteData, {}, 'pricing-matrix-test');

// The one home of what each feature IS — and the row order the matrix renders.
const FEATURES = {
  exports: { name: 'Exports' },
  seats: { name: 'Seats', usage: {} },
  support: { name: 'Priority support' },
};

// One catalog carrying every cell shape: a labelled string ("Included", the
// reported one), a number, the -1 unlimited sentinel, a bare `true`, and a
// feature the lowest tier genuinely lacks.
const CATALOG = {
  products: [
    {
      id: 'basic',
      name: 'Basic',
      type: 'subscription',
      features: { exports: 'Included', seats: 1000 },
    },
    {
      id: 'premium',
      name: 'Premium',
      type: 'subscription',
      prices: { monthly: 9.99 },
      features: { exports: 'Included', seats: -1, support: true },
    },
  ],
};

/**
 * One matrix row's markup, by the feature name in its row header.
 * @param {string} html - the rendered /pricing page
 * @param {string} name - the feature name
 * @returns {string} everything from that row's `<tr>` to its `</tr>`
 */
function row(html, name) {
  const at = html.indexOf(name, html.indexOf('<caption>Compare features</caption>'));
  expect(at > -1, `${name} has a row in the matrix`).toBeTruthy();
  const start = html.lastIndexOf('<tr', at);
  return html.slice(start, html.indexOf('</tr>', at));
}

let page;

module.exports = defineCases({
  type: 'group',
  description: 'pricing-matrix-cells',
  setup: async () => {
    page = await buildWith({ ...miniData, features: FEATURES, payment: CATALOG }).then((pages) => pages.get('/pricing'));
  },
  tests: [
    {
      name: '#562: a string cell is a YES with a label — check icon plus the value',
      run: (ctx) => {
        const exports = row(page, 'Exports');

        ctx.expect((exports.match(/omega-compare__yes/g) || []).length, 'both plans draw the check').toBe(2);
        ctx.expect((exports.match(/omega-compare__no/g) || []).length, 'and neither draws the x').toBe(0);
        ctx.expect((exports.match(/<span class="omega-compare__label">Included<\/span>/g) || []).length, 'the catalog word rides the check as its label, the way the plan cards render it').toBe(2);
      },
    },

    {
      name: '#562: a number cell keeps its formatting, and the unlimited sentinel keeps its word',
      run: (ctx) => {
        const seats = row(page, 'Seats');

        ctx.expect(seats.includes('<span class="omega-compare__label">1,000</span>'), 'omega_commaify still formats the number').toBeTruthy();
        ctx.expect(seats.includes('<span class="omega-compare__label">Unlimited</span>'), 'and -1 renders as the Unlimited label, a value like any other').toBeTruthy();
        ctx.expect((seats.match(/omega-compare__yes/g) || []).length, 'both cells are a yes').toBe(2);
      },
    },

    {
      name: '#562: `true` stays icon-only and a missing feature stays the x icon',
      run: (ctx) => {
        const support = row(page, 'Priority support');

        ctx.expect((support.match(/omega-compare__yes/g) || []).length, 'premium declares it').toBe(1);
        ctx.expect((support.match(/omega-compare__no/g) || []).length, 'basic genuinely lacks it').toBe(1);
        ctx.expect(!support.includes('omega-compare__label'), 'a bare true carries no label — the icon says it').toBeTruthy();
      },
    },

    {
      name: '#562: the two surfaces now agree on one catalog value',
      run: (ctx) => {
        // The whole point: the cards print "Included" beside their check and so does
        // the matrix, off the same value — one definition in the catalog, one value
        // per product, no second key.
        ctx.expect(page.includes('omega-price-card__features'), 'the plan cards rendered').toBeTruthy();
        ctx.expect((page.match(/Included/g) || []).length >= 4, 'the word lands on both surfaces, per plan').toBeTruthy();
      },
    },
  ],
});
